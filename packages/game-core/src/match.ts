export { createMatch } from './match-setup.ts'
import { shuffle } from './match-setup.ts'
import { applyMovementStateTriggers } from './movement.ts'
import { addTypeToken, crownBackwardRow, creaturePushLine, hasWhiteTypeTokens, returnCardToHand, scoreConditionMet, takeAndShufflePileCard } from './card-effects.ts'
import { abilityCanTargetPlayer, abilityDrawCount, adjustGambaRoll, applyCardEventEffect, discordDramaEffect, gambaModifierForUnit, applyEntryNeighborBuff, applyCombatStatChanges, applyTemporaryHealthBuff, expireTemporaryHealthBuff, expireTemporaryAttack, scoreExtraDrawCount, spellDrawCount, spellHealAndDrawEffect, spellPileSearch, spellDiscardsToOpponent, spellSwapsCreatureStats, swapCreatureStats, temporaryHealthExpiresAtTurn, deathEffectPasses, weakestCreatureTargets, entryDrawCount, entryDrawToHandSize, entryPileDraw, entrySavePiles, entryScorePlayFromDeck, takePileCard, takeTopDiscard } from './card-effects.ts'
import { abilityCostOnField, abilityCostResource, abilityDescriptions, ameHealingReward, applyStatBuff, applyUnitDamage, attackDamageForCard, attackWasDiagonal, burnGatedSpellOperation, burnsOnDeathFromField, canActWhileFlipped, canAttackBoardCard, canAttackTarget, canCounterattack, canMoveTo, canUseHealthPayment, cheapestCreatureIndexes, consumeNextScoreAdjustment, countCreaturesOnField, destroysFlippedThenFlipsSurvivors, effectiveCardDescription, effectiveUnitAttack, effectiveUnitSpeed, effectCanTargetEnemy, effectConditionMet, effectsWhenEquipped, entryBuffForCard, entryDebuffForCard, entryDiscardsEntireHand, entryEffectConditionMet, entryFieldFlipTurns, entryHandLimitDelta, entryNeighborBuffs, entryOperationConditionMet, entryOpponentDamage, entryPlayerHealAmount, entryResourceGain, entryRoundStatBuff, entryScoreConditionMet, entryTargetOperation, entryTokenGain, expireTemporaryHandLimit, finishSpellFromHand, flipTimerTicks, flexibleHealOrStunEffect, forwardMoveDestination, freeAdjacentSockets, gainBurnTriggerTokens, globalFlipTurns, globalHealingOperation, gambaDamageOperation, grantEntryEffectTokens, grantsRageUntilOwnerEnd, hasBurnTrait, hasTemporaryRage, incomingDamageReduction, initialFlipTurns, isRepeatableAbility, itemGrantsShield, killRewardForCard, movementIsBlocked, payCardCost, playerHealAmount, resolveFlipTrigger, rulesForCard, scavengerSwarmSources, scoreDiscountedCost, shouldDealCombatDamage, spellAreaDamage, spellAreaTargets, spellAuctionsCreatures, spellSacrificesTwoAllies, spellMovesTargetToSocket, spellBuffToEndTurnDeath, spellBurnsAllCreatures, spellBurnsCreature, spellDestroysBuilding, spellDrawAndLimitEffect, spellFlipOnKill, spellGlobalCreatureDamage, spellHealsCasterOnCreatureKill, spellKillsCreature, spellKillsFlippedCreatureCount, spellLineBuff, spellLineDamage, spellSavesHandOnCreatureKill, spellTargetTransfer, startTurnEffect, targetedAbilityOperation, targetedSpellDamage, targetedSpellFlipTurns, targetedSpellStunTurns, targetMatchesKind, tickFlipAtOwnerEnd, unitCanMoveAndAttack, unitMovementBlocked, winnerWhenPlayerFalls } from './card-effects.ts'

type Card = { Id: string; instanceId?: string; Name: string; Description?: string; Type: number; Cost?: number; Attack?: number; Health?: number; Speed?: number; Rarity: number; Class: number; Tags?: string[]; [key: string]: unknown }
type BoardUnit = {
  id: string; card: Card; owner: number; row: number; col: number; health: number; maxHealth: number
  attack: number; speed: number; shield?: boolean; flippedTurns?: number; stunned?: number; summoned?: number
  item?: Card; energyCostReduction?: number; dying?: boolean; attacks?: number; temporaryRage?: boolean; typeTokens?: number[]
  temporaryHealth?: number; temporaryHealthExpiresAt?: number
  temporaryAttack?: number
  cardPlayBuffs?: number
  nextAttackNegated?: boolean; nextAttackSplashDamage?: number; v1RangedCrown?: boolean; blackTokens: number; abilityUsed?: boolean; doggoBuffs?: number; [key: string]: unknown
}
type PlayerInput = { userId: string; displayName: string; deck: readonly string[] }
type StartTurnSource = { unitId: string; cardName: string; owner: number; operations: NonNullable<ReturnType<typeof startTurnEffect>>['operations'] }
type PendingStartTurn = { sources: StartTurnSource[]; sourceIndex: number; operationIndex: number; manaBonus: number[]; energyBonus: number[] }
type PlayerState = {
  userId: string; name: string; health: number; mana: number; energy: number; limit: number
  deck: Card[]; hand: Card[]; discard: Card[]; burned: Card[]; saved: Card[]
  played: boolean; burnedThisTurn: boolean; nextScoreAdjustment: number; gendaBossStacks?: number; freePlayCardIds?: string[]; nextBurnToSave?: number; nextGambaBonus?: number; temporaryLimitExpirations?: number[]; temporaryLimitOverride?: { previous: number; value: number; expiresAt: number }; depressiveHandLimit?: { previousLimit: number; override?: { previous: number; value: number; expiresAt: number } }
}
export type MatchState = {
  id: string; version: number; status: 'active' | 'finished' | 'aborted'; rulesVersion: string
  current: number; round: number; players: PlayerState[]; board: BoardUnit[]; log: string[]; movementLock?: number | null; wheatTokens?: { row: number; col: number }[]; winnerUserId?: string; endReason?: string
  pendingTurnStart?: PendingStartTurn | null
  pendingChoice?:
    | { id: string; owner: number; kind: 'heal-creature'; sourceUnitId: string; unitIds: string[]; entryTokens: number; amount?: number; flipTurns?: number }
    | { id: string; owner: number; kind: 'entry-stun-creature'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; turns: number }
    | { id: string; owner: number; kind: 'entry-damage-target'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; amount: number; roll?: number }
    | { id: string; owner: number; kind: 'entry-type-token'; sourceUnitId: string; sourceCardName: string; targetUnitId?: string; unitIds: string[]; stage: 'target' | 'token'; remaining: number }
    | { id: string; owner: number; kind: 'entry-move-building'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'entry-sacrifice-ally-heal'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; amount: number }
    | { id: string; owner: number; kind: 'entry-save-allied'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; playDeckTop?: boolean }
    | { id: string; owner: number; kind: 'entry-return-creature'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'entry-take-enemy-building'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'entry-return-creature'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'ability-heal-creature'; sourceUnitId: string; unitIds: string[]; abilityIndex: number; amount: number; shield: boolean }
    | { id: string; owner: number; kind: 'ability-damage-target'; sourceUnitId: string; unitIds: string[]; abilityIndex: number; amount: number; playerTarget: boolean }
    | { id: string; owner: number; kind: 'ability-put-target-on-deck'; sourceUnitId: string; unitIds: string[]; abilityIndex: number }
    | { id: string; owner: number; kind: 'ability-draw-or-limit'; sourceUnitId: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'ability-conveyor'; sourceUnitId: string; unitIds: string[]; stage: 'discard' | 'burn' | 'save' }
    | { id: string; owner: number; kind: 'spell-dodep'; sourceUnitId: ''; sourceCardName: string; unitIds: string[]; stage: 'burn' | 'resource'; amount?: number }
    | { id: string; owner: number; kind: 'ability-librarian'; sourceUnitId: string; unitIds: string[]; stage: 'cost' | 'pile' | 'card'; cost?: 1 | 2 | 4; pile?: 'deck' | 'discard'; abilityIndex: number }
    | { id: string; owner: number; kind: 'ability-sacrifice-building'; sourceUnitId: string; unitIds: string[]; amount: number; abilityIndex: number }
    | { id: string; owner: number; kind: 'ability-damage-targets' | 'ability-heal-targets'; sourceUnitId: string; unitIds: string[]; abilityIndex: number; amount: number; count: number; targetType?: 'creature' | 'building' }
    | { id: string; owner: number; kind: 'ability-move-self'; sourceUnitId: string; unitIds: string[]; cells: { row: number; col: number }[]; abilityIndex: number; stunAdjacent?: number }
    | { id: string; owner: number; kind: 'ability-move-front'; sourceUnitId: string; unitIds: string[]; abilityIndex: number }
    | { id: string; owner: number; kind: 'ability-swap-self'; sourceUnitId: string; unitIds: string[]; abilityIndex: number }
    | { id: string; owner: number; kind: 'spell-swap-creatures'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: number }
    | { id: string; owner: number; kind: 'spell-swap-stats'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: 2 }
    | { id: string; owner: number; kind: 'spell-destroy-creatures'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: number }
    | { id: string; owner: number; kind: 'spell-move-target'; sourceUnitId: string; sourceCardName: string; targetUnitId: string; mode: 'any' | 'opponent' | 'adjacent' | 'sideways'; cells: { row: number; col: number }[]; unitIds: string[] }
    | { id: string; owner: number; kind: 'entry-save-flipped'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'entry-take-item'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'entry-destroy-building'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'viskas-choice'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; stage: 'option' | 'discard' }
    | { id: string; owner: number; kind: 'swarm-reward'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'indigolit-heal'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; remaining: number }
    | { id: string; owner: number; kind: 'wismuth-discard'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'spell-save-hand'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: 1 }
    | { id: string; owner: number; kind: 'death-burn-flipped'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'death-save-deck-cards'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: number; totalCost: number }
    | { id: string; owner: number; kind: 'death-intivi'; sourceUnitId: string; sourceCardName: string; itemInstanceId: string; itemName: string }
    | { id: string; owner: number; kind: 'death-weaken-target'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; playerTarget: boolean }
    | { id: string; owner: number; kind: 'crown-play-saved-spell'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'spell-discard-hand'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: number }
    | { id: string; owner: number; kind: 'hand-limit-discard'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: number }
    | { id: string; owner: number; kind: 'spell-search-pile'; sourceUnitId: string; sourceCardName: string; sourceCardInstanceId: string; unitIds: string[]; pile: 'deck' | 'burned'; minimumCost: number }
    | { id: string; owner: number; kind: 'start-turn-burn'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: number }
    | { id: string; owner: number; kind: 'start-turn-shield'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'start-turn-sent-croix'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; stage: 'card' | 'cell'; cardInstanceId?: string; cells: { row: number; col: number }[] }
    | { id: string; owner: number; kind: 'start-turn-weakest-burn'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | { id: string; owner: number; kind: 'paradise-target'; sourceUnitId: string; sourceCardName: string; unitIds: string[] }
    | null
  queuedChoices?: ({ id: string; owner: number; kind: 'wismuth-discard'; sourceUnitId: string; sourceCardName: string; unitIds: string[] } | { id: string; owner: number; kind: 'swarm-reward'; sourceUnitId: string; sourceCardName: string; unitIds: string[] } | { id: string; owner: number; kind: 'paradise-target'; sourceUnitId: string; sourceCardName: string; unitIds: string[] } | { id: string; owner: number; kind: 'crown-play-saved-spell'; sourceUnitId: string; sourceCardName: string; unitIds: string[] } | { id: string; owner: number; kind: 'spell-save-hand'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: 1 } | { id: string; owner: number; kind: 'death-burn-flipped'; sourceUnitId: string; sourceCardName: string; unitIds: string[] } | { id: string; owner: number; kind: 'death-save-deck-cards'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; count: number; totalCost: number } | { id: string; owner: number; kind: 'death-intivi'; sourceUnitId: string; sourceCardName: string; itemInstanceId: string; itemName: string } | { id: string; owner: number; kind: 'death-weaken-target'; sourceUnitId: string; sourceCardName: string; unitIds: string[]; playerTarget: boolean })[]
}
export type PendingChoiceKind = NonNullable<MatchState['pendingChoice']>['kind']

function invalidCommand(code: string): never { throw Object.assign(new Error(code), { code }) }

function grantFreeTopDeckCard(state: MatchState, ownerSeat: number, sourceName: string) {
  const owner = state.players[ownerSeat]!
  const card = owner.deck.shift()
  if (!card) state.log.push(`«${sourceName}»: колода пуста, верхнюю карту разыграть нельзя.`)
  else {
    owner.hand.push(card)
    ;(owner.freePlayCardIds ??= []).push(card.instanceId!)
    state.log.push(`«${sourceName}» открывает «${card.Name}» сверху колоды для бесплатного розыгрыша.`)
  }
}

function queueWismuthChoice(state: MatchState, owner: number, sourceUnitId: string, sourceCardName: string, cards: Card[]) {
  if (cards.length !== 2) return
  state.players[owner]!.hand.push(...cards)
  const choice = { id: `choice_${state.id}_${state.version + 1}_wismuth_${sourceUnitId}`, owner, kind: 'wismuth-discard' as const, sourceUnitId, sourceCardName, unitIds: cards.map(card => card.instanceId!).filter(Boolean) }
  if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
  else state.pendingChoice = choice
}

function promoteQueuedChoice(state: MatchState) {
  if (!state.pendingChoice && state.queuedChoices?.length) state.pendingChoice = state.queuedChoices.shift()
  if (!state.queuedChoices?.length) state.queuedChoices = undefined
}

function queueSwarmRewards(state: MatchState, dead: BoardUnit) {
  if (dead.owner !== state.current || dead.card.Type !== 0) return
  for (const source of scavengerSwarmSources(state.board, state.current, dead.card.Type)) {
    const choice = { id: `choice_${source.id}_${state.version + 1}_swarm_${dead.id}`, owner: source.owner, kind: 'swarm-reward' as const, sourceUnitId: source.id, sourceCardName: 'Загребущий рой', unitIds: [] as string[] }
    if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
    else state.pendingChoice = choice
  }
}

function queueParadiseTargets(state: MatchState, sources: { id: string; owner: number }[]) {
  for (const source of sources) {
    const unitIds = state.board.filter(unit => unit.owner === source.owner && unit.card.Type === 0 && !unit.dying).map(unit => unit.id)
    if (!unitIds.length) continue
    const choice = { id: `choice_${state.id}_${state.version + 1}_paradise_${source.id}`, owner: source.owner, kind: 'paradise-target' as const, sourceUnitId: source.id, sourceCardName: 'Внешний рай', unitIds }
    if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
    else state.pendingChoice = choice
  }
}

function resolveWismuthSearch(state: MatchState, owner: number, sourceUnitId: string, sourceCardName: string, random: () => number) {
  const player = state.players[owner]!
  const cards = [takeAndShufflePileCard(player.deck, 1, random), takeAndShufflePileCard(player.deck, 3, random)].filter((card): card is Card => Boolean(card))
  if (cards.length === 1) player.hand.push(cards[0]!)
  else if (cards.length === 2) queueWismuthChoice(state, owner, sourceUnitId, sourceCardName, cards)
}

function changeHandLimit(player: PlayerState, amount: number) {
  if (player.depressiveHandLimit) return
  if (player.temporaryLimitOverride) {
    player.temporaryLimitOverride.previous = Math.max(1, player.temporaryLimitOverride.previous + amount)
    player.limit = player.temporaryLimitOverride.value
  } else player.limit = Math.max(1, player.limit + amount)
}

function addTemporaryHandLimit(player: PlayerState, amount: number, expiresAt: number) {
  if (player.depressiveHandLimit) return
  player.temporaryLimitExpirations ??= []
  for (let count = 0; count < amount; count++) player.temporaryLimitExpirations.push(expiresAt)
  if (!player.temporaryLimitOverride) player.limit += amount
}

function setTemporaryHandLimit(player: PlayerState, value: number, expiresAt: number) {
  if (player.depressiveHandLimit) return
  const override = player.temporaryLimitOverride
  const previous = override?.previous ?? Math.max(1, player.limit - (player.temporaryLimitExpirations?.length ?? 0))
  player.temporaryLimitOverride = { previous, value, expiresAt: Math.max(expiresAt, override?.expiresAt ?? 0) }
  player.limit = value
}

function enterDepressiveHandLimit(player: PlayerState) {
  if (player.depressiveHandLimit) return
  const override = player.temporaryLimitOverride
  player.depressiveHandLimit = { previousLimit: override?.previous ?? Math.max(1, player.limit - (player.temporaryLimitExpirations?.length ?? 0)), ...(override ? { override: { ...override } } : {}) }
  delete player.temporaryLimitOverride
  player.limit = 1
}

function expireHandLimitEffects(player: PlayerState, turnIndex: number) {
  const expired = expireTemporaryHandLimit(player.temporaryLimitExpirations ?? [], turnIndex)
  if (player.depressiveHandLimit) {
    player.depressiveHandLimit.previousLimit = Math.max(1, player.depressiveHandLimit.previousLimit - expired)
    player.limit = 1
    return
  }
  const override = player.temporaryLimitOverride
  if (override) {
    if (override.expiresAt <= turnIndex) {
      player.limit = Math.max(1, override.previous + (player.temporaryLimitExpirations?.length ?? 0))
      delete player.temporaryLimitOverride
    } else player.limit = override.value
  } else player.limit = Math.max(1, player.limit - expired)
}

const depressiveJawDescription = 'Вход: Сбросьте свою руку.\nПостоянно: Ваш лимит карт равняется 1 и его нельзя изменить пока Депрессивная жопа на поле. Вы можете вытащить 1 карту из КД, в начале хода.'

function burnPileCard(state: MatchState, seat: number, card: Card) {
  const player = state.players[seat]!
  if ((player.nextBurnToSave ?? 0) > 0) { player.nextBurnToSave!--; player.saved.push(card); return }
  player.burned.push(card)
  if (seat === state.current) player.burnedThisTurn = true
  gainBurnTriggerTokens(state.board, seat)
  applyCardEventEffect(card.Description ?? '', 'burn', amount => { player.health = Math.min(45, player.health + amount) }, count => {
    for (let index = 0; index < count && player.deck.length; index++) player.hand.push(player.deck.shift()!)
  })
}

function finishCastSpell(state: MatchState, seat: number, instanceId: string, discardSeat = seat) {
  const player = state.players[seat]!
  const index = player.hand.findIndex(card => card.instanceId === instanceId)
  if (index < 0) invalidCommand('CARD_NOT_IN_HAND')
  const spell = player.hand[index]!
  let burned = false
  finishSpellFromHand(player.hand, state.players[discardSeat]!.discard, player.burned, index, amount => { player.health = Math.min(45, player.health + amount) }, count => {
    for (let i = 0; i < count && player.deck.length; i++) player.hand.push(player.deck.shift()!)
  }, burnedCard => {
    if ((player.nextBurnToSave ?? 0) > 0) { player.nextBurnToSave!--; player.saved.push(burnedCard); return false }
    player.burned.push(burnedCard)
    gainBurnTriggerTokens(state.board, seat)
    burned = true
    return true
  })
  if (burned && seat === state.current) player.burnedThisTurn = true
  consumeNextScoreAdjustment(player, spell.Description ?? '')
  player.played = true
}
const tauCannonDescription = 'Способность 0: Получает 1\nПостоянно: Если у этого существа стат атаки 5 или более, то оно умирает а тау пушка сжигаеться.'
function isTauCannon(item?: Card) { return item?.Name === 'Тау-пушка' && item.Type === 1 && item.Description?.replace(/\r\n/gu, '\n') === tauCannonDescription }
function isShieldItem(item?: Card) { return item?.Name === 'Щит' && item.Type === 1 && item.Description === 'Щит\nПостоянно: Существо не восприимчиво к атакам с Досягаемостью. В начале вашего хода владелец получает Щит.' }

function unitIsActive(match: MatchState, unit: BoardUnit, actorSeat: number) {
  const description = effectiveCardDescription(unit.card.Description ?? '', unit.item?.Description ?? '')
  return unit.owner === actorSeat && !unit.dying && !unit.stunned && (!unit.flippedTurns || canActWhileFlipped(description)) && (unit.card.Type === 3 || typeof unit.summoned === 'number' && unit.summoned < match.round || description.includes('Порыв') || match.board.some(other => other.owner === unit.owner && other.card.Name === 'Вечная ночь' && !other.dying))
}

function hasOnlySupportedStartTurnText(description: string, operationCount: number) {
  const trigger = /В начале (?:вашего |каждого |своего )?хода/iu
  const lines = description.split(/\r?\n/u).flatMap(line => {
    const at = line.search(trigger)
    if (at < 0) return []
    const prefix = line.slice(0, at)
    const boundary = Math.max(prefix.lastIndexOf('.'), prefix.lastIndexOf(';'))
    return [line.slice(boundary + 1)]
  })
  if (lines.length === 1 && operationCount === 1) {
    if (description.trim() === depressiveJawDescription) return true
    if (/^Постоянно:\s*В начале своего хода сожгите самое слабое существо на поле \[Кроме Дедруби\]$/iu.test(lines[0]!)) return true
    if (/^Постоянно:\s*В начале хода Гамба:\r?\n1-2 - умирает\.\r?\n3-6 - Ничего не происходит\.$/imu.test(description)) return true
    if (/^Постоянно:\s*В начале хода:\r?\nГамба: 1, 3, 5 - Восстанавливает 1 здоровье вам и всем вашим существам\r?\n2, 4, 6 - Наносит 1 урона всем врагам включая противника\.$/imu.test(description)) return true
  }
  const resource = /\d+\s+(?:ман[ауые]|энерг(?:ии|ию))/giu
  const losses = /(?:вы\s+)?теряете\s+\d+\s+здоровья/giu
  const damage = /Наносит\s+(?:противнику|врагу)\s+\d+\s+урона/giu
  const draw = /Возьмите\s+\d*\s*карт(?:у|ы)?/giu
  const moveForward = /передвига[а-яё]*\s+впер[её]д\s+на\s+1\s+сокет/giu
  const burn = /Сожгите\s+\d+\s+карт(?:у|ы)\s+из\s+(?:вашей|своей)\s+руки/giu
  const sentCroix = /выставьте рядом с Сент-круа самое деш[её]вое существо из руки/giu
  const conditionalBurn = /Если у вас лимит карт\s*\d+\s+и больше,\s*сожгите\s+\d+\s+карт(?:у|ы)/giu
  const shield = /дайте щит выбранному существу вокруг/giu
  const count = (line: string, pattern: RegExp) => [...line.matchAll(pattern)].length
  if (!lines.length || lines.reduce((total, line) => total + count(line, resource) + count(line, losses) + count(line, damage) + count(line, draw) + count(line, moveForward) + count(line, burn) + count(line, conditionalBurn) + count(line, shield) + count(line, sentCroix), 0) !== operationCount) return false
  return lines.every(line => !line.replace(resource, '').replace(losses, '').replace(damage, '').replace(draw, '').replace(moveForward, '').replace(burn, '').replace(conditionalBurn, '').replace(shield, '').replace(sentCroix, '').replace(/получ(?:аете|ает|ите)/giu, '').replace(/Постоянно\s*:/giu, '').replace(/В начале (?:вашего |каждого |своего )?хода/giu, '').replace(/\(своего и чужого\)/giu, '').replace(/(^|\s)(?:и|но|вы)(?=\s|$)/giu, '$1').replace(/[^\p{L}\p{N}]/gu, '').trim())
}

function hasOnlySupportedCrownText(description: string, operations: ReturnType<typeof rulesForCard>['crown']) {
  if (operations?.length === 1 && operations[0]?.kind === 'gamba-damage-or-heal-target') return description.replace(/\r\n/gu, '\n').includes('Коронный: Гамба:\n1.3.5 - Наносит 5 урона атакуемому.\n2.4.6 - Восстанавливает 5 здоровья атакуемому')
  const lines = description.split(/\r?\n/u).filter(line => /Коронный(?:\s+и\s+Ловушка)?\s*:/iu.test(line))
  if (!lines.length || !operations?.length) return false
  const patterns = [
    { kind: 'draw', pattern: /Возьмите\s+\d*\s*карт(?:у|ы)?/giu },
    { kind: 'viskas-choice', pattern: /Возьмите или сбросьте карту/giu },
    { kind: 'play-saved-spell', pattern: /Разыграйте заклинание из сбережений/giu },
    { kind: 'gain-mana', pattern: /Вы\s+получаете\s+\d+\s+маны/giu },
    { kind: 'gain-black-token', pattern: /Получает\s+\d+\s*⚫/giu },
    { kind: 'increase-hand-limit', pattern: /Увеличивает\s+лимит\s+карт\s+на\s+\d+/giu },
    { kind: 'stun-target', pattern: /Выбранное\s+существо\s+получает\s+оглушение\s+\d+/giu },
    { kind: 'heal-player', pattern: /Восстанавливает\s+владельцу\s+\d+\s+здоровья/giu },
    { kind: 'heal-attacker', pattern: /Восстанавливает\s+себе\s+\d+\s+здоровья/giu },
    { kind: 'damage-player', pattern: /Наносит\s+\d+\s+урона?\s+противнику/giu },
    { kind: 'damage-target', pattern: /Наносит\s+\d+\s+урон(?:а)?(?![\p{L}])(?!\s+(?:противнику|всем\s+существам\s+вокруг\s+цели))/giu },
    { kind: 'damage-surrounding-creatures', pattern: /Наносит\s+\d+\s+урона?\s+всем\s+существам\s+вокруг\s+цели/giu },
    { kind: 'move-target-adjacent', pattern: /Передвигает\s+атакованную\s+карту\s+на\s+1\s+сокет/giu },
    { kind: 'move-target-backward', pattern: /Передвигает\s+атакованное\s+существо\s+на\s+1\s+сокет\s+назад/giu },
    { kind: 'move-target-sideways', pattern: /Толкает\s+атакуемое\s+существо\s+направо\s+или\s+налево/giu },
    { kind: 'move-target-any', pattern: /Переносит\s+атакуемое\s+существо\s+на\s+любой\s+свободный\s+сокет/giu },
    { kind: 'burn-attacker-and-target', pattern: /Сжигает\s+атакуемое\s+существо\s+и\s+существо\s+владельца/giu },
    { kind: 'flip-attacker', pattern: /Получает\s+Переворот\s+\d+/giu },
    { kind: 'destroy-target-item-or-building', pattern: /Уничтожает\s+предмет\s+на\s+атакуемом\s+существе\s+или\s+атакуемое\s+здани(?:е|и)/giu },
    { kind: 'destroy-target', pattern: /Убивает\s+существо(?!,?\s+если)|Убейте\s+существо/giu },
    { kind: 'destroy-self', pattern: /Умирает/giu },
    { kind: 'destroy-target-if-damaged', pattern: /Убивает\s+существо,?\s+если\s+у\s+него\s+не\s+полное\s+здоровье/giu },
    { kind: 'return-attacker-to-hand', pattern: /Возвращает(?:ься)?\s+обратно\s+в\s+руку/giu },
  ] as const
  if (patterns.some(({ kind, pattern }) => operations.filter(operation => operation.kind === kind).length !== lines.reduce((count, line) => count + [...line.matchAll(pattern)].length, 0))) return false
  const supported = /Счёт\s*>\s*5\s*:\s*|Разыграйте заклинание из сбережений|Возьмите или сбросьте карту|Коронный(?:\s+и\s+Ловушка)?\s*:|Возьмите\s+\d*\s*карт(?:у|ы)?|Вы\s+получаете\s+\d+\s+маны|Получает\s+Переворот\s+\d+|Получает\s+\d+\s*⚫|Увеличивает\s+лимит\s+карт\s+на\s+\d+|Выбранное\s+существо\s+получает\s+оглушение\s+\d+|Уничтожает\s+предмет\s+на\s+атакуемом\s+существе\s+или\s+атакуемое\s+здани(?:е|и)|Передвигает\s+атакованную\s+карту\s+на\s+1\s+сокет|Передвигает\s+атакованное\s+существо\s+на\s+1\s+сокет\s+назад|Толкает\s+атакуемое\s+существо\s+направо\s+или\s+налево|Переносит\s+атакуемое\s+существо\s+на\s+любой\s+свободный\s+сокет|а\s+так\s+же|Восстанавливает\s+(?:себе|владельцу)\s+\d+\s+здоровья|Наносит\s+\d+\s+урона?\s+всем\s+существам\s+вокруг\s+цели|Сжигает\s+атакуемое\s+существо\s+и\s+существо\s+владельца|Наносит\s+\d+\s+урона?(?:\s+противнику)?|Убивает\s+существо,?\s+если\s+у\s+него\s+не\s+полное\s+здоровье|Убивает\s+существо|Убейте\s+существо|Умирает|Возвращает(?:ься)?\s+обратно\s+в\s+руку/giu
  return lines.every(line => !line.replace(supported, '').replace(/[^\p{L}\p{N}]/gu, '').trim())
}

function transferEquippedItem(state: MatchState, receiver: BoardUnit, donor: BoardUnit) {
  const item = donor.item
  if (!item || receiver.item || receiver.id === donor.id) return false
  donor.item = undefined
  donor.attack -= Number(item.Attack ?? 0)
  donor.maxHealth -= Number(item.Health ?? 0)
  donor.health = Math.min(donor.health, donor.maxHealth)
  donor.nextAttackNegated = Boolean(rulesForCard(donor.card.Name).negateNextAttack)
  for (const effect of effectsWhenEquipped(item.Name)) {
    if (effect.kind === 'decrease-hand-limit') changeHandLimit(state.players[donor.owner]!, effect.amount)
    else if (effect.kind === 'change-attack') donor.attack -= effect.amount
  }
  receiver.item = item
  receiver.attack += Number(item.Attack ?? 0)
  receiver.health += Number(item.Health ?? 0)
  receiver.maxHealth += Number(item.Health ?? 0)
  receiver.nextAttackNegated = Boolean(rulesForCard(item.Name).negateNextAttack)
  if (itemGrantsShield(item.Description ?? '')) receiver.shield = true
  for (const effect of effectsWhenEquipped(item.Name)) {
    if (effect.kind === 'decrease-hand-limit') changeHandLimit(state.players[receiver.owner]!, -effect.amount)
    else if (effect.kind === 'change-attack') receiver.attack += effect.amount
  }
  return true
}

function applySimpleCrown(state: MatchState, source: BoardUnit, target?: BoardUnit, ranged = false, random: () => number = Math.random) {
  const operations = [...(rulesForCard(source.card.Name).crown ?? []), ...(source.item ? rulesForCard(source.item.Name).crown ?? [] : [])]
  for (const operation of operations) {
    if (operation.kind === 'draw') for (let index = 0; index < operation.count && state.players[source.owner]!.deck.length; index++) state.players[source.owner]!.hand.push(state.players[source.owner]!.deck.shift()!)
    else if (operation.kind === 'gain-mana') state.players[source.owner]!.mana += operation.amount
    else if (operation.kind === 'gain-black-token') source.blackTokens = (source.blackTokens ?? 0) + operation.amount
    else if (operation.kind === 'increase-hand-limit') changeHandLimit(state.players[source.owner]!, operation.amount)
    else if (operation.kind === 'play-saved-spell') {
      const player = state.players[source.owner]!
      const unitIds = player.saved.filter(card => card.Type === 2 && card.instanceId).map(card => card.instanceId!)
      if (unitIds.length) {
        const choice = { id: `choice_${source.id}_${state.version + 1}_saved_spell`, owner: source.owner, kind: 'crown-play-saved-spell' as const, sourceUnitId: source.id, sourceCardName: source.card.Name, unitIds }
        if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
        else state.pendingChoice = choice
      }
    }
    else if (operation.kind === 'stun-target') { if (target?.card.Type === 0) target.stunned = (target.stunned ?? 0) + operation.turns }
    else if (operation.kind === 'heal-player') state.players[source.owner]!.health = Math.min(45, state.players[source.owner]!.health + operation.amount)
    else if (operation.kind === 'heal-attacker') source.health = Math.min(source.maxHealth, source.health + operation.amount)
    else if (operation.kind === 'damage-target') {
      if (target && !target.dying && targetMatchesKind(target.card.Type, operation.targetType)) applyTriggeredDamage(state, target, operation.amount, source)
    }
    else if (operation.kind === 'damage-surrounding-creatures') {
      if (target) for (const unit of state.board.filter(unit => unit.id !== target.id && unit.card.Type === 0 && !unit.dying && !unit.flippedTurns && Math.max(Math.abs(unit.row - target.row), Math.abs(unit.col - target.col)) === 1)) applyTriggeredDamage(state, unit, operation.amount, source)
    }
    else if (operation.kind === 'gamba-damage-or-heal-target') {
      if (target && !target.dying && target.health > 0) {
        const player = state.players[source.owner]!
        const roll = adjustGambaRoll(Math.floor(random() * 6) + 1, gambaModifierForUnit(source) + (player.nextGambaBonus ?? 0))
        player.nextGambaBonus = 0
        if (operation.damagingRolls.includes(roll)) applyTriggeredDamage(state, target, operation.amount, source)
        else {
          const before = target.health
          target.health = Math.min(target.maxHealth, target.health + operation.amount)
          if (target.card.Type === 0 && target.health > before && state.board.some(unit => unit.owner === target.owner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Розовый Алмаз')) target.shield = true
          const reward = ameHealingReward(state.board, target.owner, before, target.maxHealth, target.health - before)
          if (reward) state.board.filter(unit => unit.owner === target.owner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Аме').forEach(unit => unit.attack++)
        }
        state.log.push(`«Пилюля»: гамба ${roll}.`)
      }
    }
    else if (operation.kind === 'burn-attacker-and-target') {
      if (target?.card.Type === 0 && !target.dying) applyTriggeredDamage(state, target, 0, source, true, true, 0, false, random)
      if (!source.dying && state.board.includes(source)) applyTriggeredDamage(state, source, 0, undefined, true, true, 0, false, random)
    }
    else if (operation.kind === 'destroy-self') applyTriggeredDamage(state, source, 0, undefined, true, false, 0, false, random)
    else if ((operation.kind === 'move-target-adjacent' || operation.kind === 'move-target-sideways' || operation.kind === 'move-target-any') && target && !target.dying && target.health > 0 && (operation.kind === 'move-target-adjacent' || target.card.Type === 0)) {
      const cells = operation.kind === 'move-target-adjacent'
        ? [[target.row - 1, target.col], [target.row + 1, target.col], [target.row, target.col - 1], [target.row, target.col + 1]]
        : operation.kind === 'move-target-sideways' ? [[target.row, target.col - 1], [target.row, target.col + 1]]
          : Array.from({ length: 25 }, (_, index) => [Math.floor(index / 5), index % 5])
      const available = cells.filter(([row, col]) => row! >= 0 && row! < 5 && col! >= 0 && col! < 5 && !state.board.some(unit => unit.id !== target.id && unit.row === row && unit.col === col)).map(([row, col]) => ({ row: row!, col: col! }))
      if (available.length) state.pendingChoice = { id: `choice_${source.id}_${state.version + 1}_crown_move`, owner: source.owner, kind: 'spell-move-target', sourceUnitId: source.id, sourceCardName: source.item?.Name && rulesForCard(source.item.Name).crown?.includes(operation) ? source.item.Name : source.card.Name, targetUnitId: target.id, mode: operation.kind === 'move-target-adjacent' ? 'adjacent' : operation.kind === 'move-target-sideways' ? 'sideways' : 'any', cells: available, unitIds: [] }
    }
    else if (operation.kind === 'move-target-backward' && target?.card.Type === 0 && !target.dying && !target.flippedTurns && !unitMovementBlocked(target) && !movementIsBlocked(state.movementLock ?? null, state.current)) {
      const row = crownBackwardRow(target.owner, target.row)
      if (row !== null && !state.board.some(unit => unit.id !== target.id && unit.row === row && unit.col === target.col)) target.row = row
    }
    else if (operation.kind === 'flip-attacker') {
      source.flippedTurns = operation.turns
      const trigger = resolveFlipTrigger(source.card.Name, source)
      Object.assign(source, trigger.state)
      for (let index = 0; index < trigger.draw && state.players[source.owner]!.deck.length; index++) state.players[source.owner]!.hand.push(state.players[source.owner]!.deck.shift()!)
      state.players[source.owner]!.mana += trigger.mana
    }
    else if (operation.kind === 'destroy-target-item-or-building') {
      if (target?.card.Type === 3) applyTriggeredDamage(state, target, 0, source, true)
      else if (target?.card.Type === 0 && target.item) {
        const item = target.item
        target.item = undefined
        target.attack -= Number(item.Attack ?? 0)
        target.maxHealth -= Number(item.Health ?? 0)
        target.health = Math.min(target.health, target.maxHealth)
        target.nextAttackNegated = Boolean(rulesForCard(target.card.Name).negateNextAttack)
        for (const effect of effectsWhenEquipped(item.Name)) {
          if (effect.kind === 'decrease-hand-limit') changeHandLimit(state.players[target.owner]!, effect.amount)
          else if (effect.kind === 'change-attack') target.attack -= effect.amount
        }
        state.players[target.owner]!.discard.push(item)
      }
    }
    else if (operation.kind === 'destroy-target') {
      if (target && !target.dying && targetMatchesKind(target.card.Type, operation.targetType)) applyTriggeredDamage(state, target, 0, source, true)
    }
    else if (operation.kind === 'destroy-target-if-damaged') {
      if (target && !target.dying && targetMatchesKind(target.card.Type, operation.targetType) && target.health < target.maxHealth) applyTriggeredDamage(state, target, 0, source, true)
    }
    else if (operation.kind === 'viskas-choice') {
      const player = state.players[source.owner]!
      const description = effectiveCardDescription(source.card.Description ?? '', source.item?.Description ?? '')
      if (scoreConditionMet(description, player.hand.length) && (player.deck.length || player.hand.length)) state.pendingChoice = { id: `choice_${source.id}_${state.version + 1}_viskas`, owner: source.owner, kind: 'viskas-choice', sourceUnitId: source.id, sourceCardName: source.card.Name, unitIds: [], stage: 'option' }
    }
    else if (operation.kind === 'return-attacker-to-hand') returnCardToHand(state.board, state.players[source.owner]!.hand, state.players[source.owner]!.discard, source.id)
    else if (operation.kind === 'damage-player') {
      const targetSeat = (1 - source.owner) as 0 | 1
      const target = state.players[targetSeat]!
      target.health = Math.max(0, target.health - operation.amount)
      if (!target.health) {
        state.status = 'finished'
        state.winnerUserId = state.players[winnerWhenPlayerFalls(targetSeat)]!.userId
        state.endReason = 'combat'
      }
    } else invalidCommand('UNSUPPORTED_EFFECT')
  }
  const rules = rulesForCard(source.card.Name)
  if (rules.healSelfToFullOnCrown && (!ranged || source.v1RangedCrown)) {
    source.health = source.maxHealth
    if (rules.healPlayerByAttackOnCrown) state.players[source.owner]!.health = Math.min(45, state.players[source.owner]!.health + effectiveUnitAttack(source))
  }
}

function hasOnlySupportedTrapText(description: string, operations: ReturnType<typeof rulesForCard>['trap']) {
  const lines = description.split(/\r?\n/u).filter(line => /(?:Ловушка(?:\s+и\s+Коронный)?|Коронный\s+и\s+Ловушка)\s*:/iu.test(line))
  if (!lines.length || !operations?.length) return false
  const attackerDamage = /Наносит\s+\d+\s+урона?(?![\p{L}])(?!\s+противнику)/giu
  const playerDamage = /Наносит\s+\d+\s+урона?\s+противнику/giu
  const destroy = /Убивает\s+атакующее\s+существо|Убейте\s+существо/giu
  const control = /Нападавший\s+становится\s+вашим\s+существом/giu
  const giveItem = /Отдаёт предмет нападавшему, а так же получает \+(\d+)⚔️/giu
  if (operations.filter(operation => operation.kind === 'damage-attacker').length !== lines.reduce((count, line) => count + [...line.matchAll(attackerDamage)].length, 0) || operations.filter(operation => operation.kind === 'damage-attacking-player').length !== lines.reduce((count, line) => count + [...line.matchAll(playerDamage)].length, 0) || operations.filter(operation => operation.kind === 'destroy-attacker').length !== lines.reduce((count, line) => count + [...line.matchAll(destroy)].length, 0) || operations.filter(operation => operation.kind === 'take-control-attacker').length !== lines.reduce((count, line) => count + [...line.matchAll(control)].length, 0) || operations.filter(operation => operation.kind === 'give-item-to-attacker-and-buff').some(operation => operation.amount !== Number(lines.flatMap(line => [...line.matchAll(giveItem)].map(match => match[1]))[0])) || operations.filter(operation => operation.kind === 'give-item-to-attacker-and-buff').length !== lines.reduce((count, line) => count + [...line.matchAll(giveItem)].length, 0)) return false
  const supported = /(?:Ловушка(?:\s+и\s+Коронный)?|Коронный\s+и\s+Ловушка)\s*:|Наносит\s+\d+\s+урона?(?:\s+противнику)?|Убивает\s+атакующее\s+существо|Убейте\s+существо|Нападавший\s+становится\s+вашим\s+существом|Отдаёт предмет нападавшему, а так же получает \+\d+⚔️/giu
  return lines.every(line => !line.replace(supported, '').replace(/[^\p{L}\p{N}]/gu, '').trim())
}

function resumeStartTurn(state: MatchState, queue: PendingStartTurn, random: () => number) {
  const events = []
  state.pendingTurnStart = queue
  while (state.status === 'active' && queue.sourceIndex < queue.sources.length) {
    const start = queue.sources[queue.sourceIndex]!
    if (queue.operationIndex >= start.operations.length) { queue.sourceIndex++; queue.operationIndex = 0; continue }
    const operation = start.operations[queue.operationIndex++]!
    if (operation.kind === 'draw') for (let count = 0; count < operation.count && state.players[start.owner]!.deck.length; count++) state.players[start.owner]!.hand.push(state.players[start.owner]!.deck.shift()!)
    else if (operation.kind === 'take-top-discard') {
      const card = takeTopDiscard(state.players[start.owner]!.discard)
      if (card) state.players[start.owner]!.hand.push(card)
    }
    else if (operation.kind === 'gain-mana') queue.manaBonus[start.owner]! += operation.amount
    else if (operation.kind === 'gain-energy') queue.energyBonus[start.owner]! += operation.amount
    else if (operation.kind === 'move-self-forward') {
      const moved = state.board.find(unit => unit.id === start.unitId)
      if (moved && !movementIsBlocked(state.movementLock ?? null, state.current) && !unitMovementBlocked(moved) && unitCanMoveAndAttack(moved, state.board)) {
        const destination = forwardMoveDestination(moved.owner, moved.row, moved.col, state.board.some(other => other.row === moved.row + (moved.owner === 0 ? -1 : 1) && other.col === moved.col))
        if (destination) {
          const from = { row: moved.row, col: moved.col }
          const speed = effectiveUnitSpeed({ ...moved, shield: Boolean(moved.shield) })
          moved.row = destination.row
          moved.col = destination.col
          applyMovementTriggers(state, moved, from, speed)
        }
      }
    } else if (operation.kind === 'damage-player') {
      const targetSeat = operation.target === 'opponent' ? 1 - start.owner : start.owner
      const target = state.players[targetSeat]!
      target.health = Math.max(0, target.health - operation.amount)
      if (target.health <= 0) {
        state.status = 'finished'
        state.winnerUserId = state.players[winnerWhenPlayerFalls(targetSeat as 0 | 1)]!.userId
        state.endReason = 'start-turn'
      }
    } else if (operation.kind === 'burn-weakest-creature') {
      const source = state.board.find(unit => unit.id === start.unitId && !unit.dying)
      const targets = source ? weakestCreatureTargets(state.board, source.id) : []
      if (targets.length > 1) {
        state.pendingChoice = { id: `choice_${start.unitId}_${state.version + 1}_weakest`, owner: start.owner, kind: 'start-turn-weakest-burn', sourceUnitId: start.unitId, sourceCardName: start.cardName, unitIds: targets.map(unit => unit.id) }
        events.push({ type: 'start-turn.effect', unitId: start.unitId })
        return events
      }
      if (targets.length === 1) applyTriggeredDamage(state, targets[0]!, 0, undefined, true, true)
    } else if (operation.kind === 'gamba-destroy-self' || operation.kind === 'gamba-heal-allies-or-damage-enemies') {
      const source = state.board.find(unit => unit.id === start.unitId && !unit.dying)
      if (source) {
        const player = state.players[start.owner]!
        const roll = adjustGambaRoll(Math.floor(random() * 6) + 1, gambaModifierForUnit(source) + (player.nextGambaBonus ?? 0))
        player.nextGambaBonus = 0
        if (operation.kind === 'gamba-destroy-self') {
          if (roll <= operation.maximumRoll) applyTriggeredDamage(state, source, 0, undefined, true)
        } else if (operation.healingRolls.includes(roll)) {
          for (const target of state.board.filter(unit => unit.owner === start.owner && unit.card.Type === 0 && !unit.dying)) {
            const before = target.health
            target.health = Math.min(target.maxHealth, target.health + operation.amount)
            if (!target.flippedTurns && state.board.some(unit => unit.owner === target.owner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Розовый Алмаз')) target.shield = true
            if (ameHealingReward(state.board, target.owner, before, target.maxHealth, target.health - before)) state.board.filter(unit => unit.owner === target.owner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Аме').forEach(unit => unit.attack++)
          }
          player.health = Math.min(45, player.health + operation.amount)
        } else {
          for (const target of state.board.filter(unit => unit.owner !== start.owner && !unit.dying)) applyTriggeredDamage(state, target, operation.amount)
          const targetSeat = 1 - start.owner
          const opponent = state.players[targetSeat]!
          opponent.health = Math.max(0, opponent.health - operation.amount)
          if (!opponent.health) { state.status = 'finished'; state.winnerUserId = player.userId; state.endReason = 'start-turn' }
        }
        state.log.push(`«${start.cardName}»: гамба ${roll}.`)
        events.push({ type: 'start-turn.gamba.resolved', unitId: start.unitId, roll })
      }
    } else if (operation.kind === 'burn-hand-card' || operation.kind === 'burn-hand-card-if-hand-limit-at-least') {
      const player = state.players[start.owner]!
      const count = operation.kind === 'burn-hand-card' || player.limit >= operation.minimumLimit ? operation.count : 0
      const burnCount = Math.min(count, player.hand.length)
      if (burnCount) {
        state.pendingChoice = { id: `choice_${start.unitId}_${state.version + 1}_burn`, owner: start.owner, kind: 'start-turn-burn', sourceUnitId: start.unitId, sourceCardName: start.cardName, unitIds: player.hand.map(card => card.instanceId).filter((id): id is string => Boolean(id)), count: burnCount }
        events.push({ type: 'start-turn.effect', unitId: start.unitId })
        return events
      }
    } else if (operation.kind === 'play-cheapest-creature-adjacent') {
      const source = state.board.find(unit => unit.id === start.unitId && !unit.dying && !unit.flippedTurns)
      const hand = state.players[start.owner]!.hand
      const cells = source ? freeAdjacentSockets(source.row, source.col, state.board) : []
      const unitIds = cheapestCreatureIndexes(hand).map(index => hand[index]!.instanceId).filter((id): id is string => Boolean(id))
      if (unitIds.length && cells.length) {
        state.pendingChoice = { id: `choice_${start.unitId}_${state.version + 1}_summon`, owner: start.owner, kind: 'start-turn-sent-croix', sourceUnitId: start.unitId, sourceCardName: start.cardName, unitIds, stage: 'card', cells: [] }
        events.push({ type: 'start-turn.effect', unitId: start.unitId })
        return events
      }
    } else if (operation.kind === 'shield-surrounding-creature') {
      const source = state.board.find(unit => unit.id === start.unitId)
      const targets = source ? state.board.filter(unit => unit.card.Type === 0 && !unit.dying && !unit.flippedTurns && !unit.shield && Math.max(Math.abs(unit.row - source.row), Math.abs(unit.col - source.col)) === 1) : []
      if (targets.length) {
        state.pendingChoice = { id: `choice_${start.unitId}_${state.version + 1}_shield`, owner: start.owner, kind: 'start-turn-shield', sourceUnitId: start.unitId, sourceCardName: start.cardName, unitIds: targets.map(unit => unit.id) }
        events.push({ type: 'start-turn.effect', unitId: start.unitId })
        return events
      }
    } else invalidCommand('UNSUPPORTED_EFFECT')
    events.push({ type: 'start-turn.effect', unitId: start.unitId })
    if (state.status === 'finished') break
  }
  state.pendingTurnStart = null
  if (state.status !== 'active') return events
  const nextSeat = state.current
  const nextPlayer = state.players[nextSeat]!
  while (nextPlayer.hand.length < nextPlayer.limit && nextPlayer.deck.length) nextPlayer.hand.push(nextPlayer.deck.shift()!)
  nextPlayer.mana = Math.min(state.round, 10) + queue.manaBonus[nextSeat]!
  nextPlayer.energy = Math.min(state.round, 10) + queue.energyBonus[nextSeat]!
  for (let seat = 0; seat < 2; seat++) {
    if (seat !== nextSeat) {
      state.players[seat]!.mana += queue.manaBonus[seat]!
      state.players[seat]!.energy += queue.energyBonus[seat]!
    }
  }
  if (state.status === 'active' && nextPlayer.hand.length > nextPlayer.limit) {
    state.pendingChoice = { id: `choice_${state.id}_${state.version + 1}_limit`, owner: nextSeat, kind: 'hand-limit-discard', sourceUnitId: '', sourceCardName: 'Лимит руки', unitIds: nextPlayer.hand.map(card => card.instanceId!), count: nextPlayer.hand.length - nextPlayer.limit }
  }
  return events
}

function endTurn(match: MatchState, actorSeat: number, data: Record<string, unknown>, random: () => number) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  const state = structuredClone(match)
  const player = state.players[actorSeat]!
  const option = data.option
  let discardCount = 0
  if (player.played) {
    if (Object.keys(data).length) invalidCommand('INVALID_COMMAND')
  } else if (option === 'no_penalty') {
    if (Object.keys(data).length !== 1) invalidCommand('INVALID_COMMAND')
  } else if (option === 'discard_and_decrease_limit') {
    const ids = data.discardedCardInstanceIds
    if (Object.keys(data).length !== 2 || !Array.isArray(ids) || ids.length < 1 || ids.length > 2 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) invalidCommand('INVALID_COMMAND')
    const cards = ids.map(id => player.hand.find(card => card.instanceId === id))
    if (cards.some(card => !card)) invalidCommand('INVALID_COMMAND')
    for (const card of cards) {
      player.hand.splice(player.hand.indexOf(card!), 1)
      player.discard.push(card!)
    }
    changeHandLimit(player, -1)
    discardCount = cards.length
  } else if (option === 'increase_limit_after_round_5') {
    if (match.round < 5 || player.depressiveHandLimit || Object.keys(data).length !== 1) invalidCommand('INVALID_COMMAND')
    changeHandLimit(player, 1)
  } else invalidCommand('INVALID_COMMAND')

  expireHandLimitEffects(player, (state.round - 1) * 2 + actorSeat)

  const endTurnEvents: { type: 'end-turn.effect'; unitId: string }[] = []
  for (const unit of state.board.filter(unit => !unit.dying && !unit.flippedTurns)) {
    if (unit.owner === actorSeat && unit.card.Name === 'Аква') {
      if (unit.card.Description !== 'Постоянно: В конце Вашего хода наносит 1+ урона противнику, затем получает 1.') invalidCommand('UNSUPPORTED_EFFECT')
      const opponent = state.players[1 - actorSeat]!
      opponent.health = Math.max(0, opponent.health - 1 - (unit.typeTokens?.[3] ?? 0))
      unit.typeTokens ??= [0, 0, 0, 0, 0, 0]
      unit.typeTokens[3] = (unit.typeTokens[3] ?? 0) + 1
      endTurnEvents.push({ type: 'end-turn.effect', unitId: unit.id })
      if (!opponent.health) {
        state.status = 'finished'
        state.winnerUserId = player.userId
        state.endReason = 'end-turn'
      }
    }
    if (unit.card.Name === 'Бункерный паук') {
      if (unit.card.Description !== 'Постоянно: Все существа вокруг в конце любого хода получают −1 к скорости.') invalidCommand('UNSUPPORTED_EFFECT')
      const targets = state.board.filter(target => target.card.Type === 0 && !target.dying && !target.flippedTurns && Math.max(Math.abs(target.row - unit.row), Math.abs(target.col - unit.col)) === 1)
      for (const target of targets) Object.assign(target, applyCombatStatChanges(target, 0, -1))
      if (targets.length) endTurnEvents.push({ type: 'end-turn.effect', unitId: unit.id })
    }
    if (state.status === 'finished') break
  }
  if (state.status === 'finished') {
    state.version++
    return { state, events: endTurnEvents }
  }

  for (const unit of state.board.filter(unit => unit.owner === actorSeat && (unit.cardPlayBuffs ?? 0) > 0 && !unit.dying)) {
    const amount = unit.cardPlayBuffs!
    unit.attack -= amount
    unit.health -= amount
    unit.maxHealth -= amount
    unit.cardPlayBuffs = 0
    if (unit.health <= 0) applyTriggeredDamage(state, unit, 0, undefined, true)
  }

  const turnIndex = (state.round - 1) * 2 + actorSeat
  for (const unit of state.board.filter(unit => temporaryHealthExpiresAtTurn(unit.temporaryHealthExpiresAt ?? 0, turnIndex) && (unit.temporaryHealth ?? 0) > 0 && !unit.dying)) {
    Object.assign(unit, expireTemporaryHealthBuff({ ...unit, temporaryHealth: unit.temporaryHealth! }))
    unit.temporaryHealthExpiresAt = 0
    if (unit.health <= 0) applyTriggeredDamage(state, unit, 0, undefined, true)
  }
  for (const unit of state.board.filter(unit => unit.owner === actorSeat && (unit.temporaryAttack ?? 0) > 0 && !unit.dying)) Object.assign(unit, expireTemporaryAttack({ ...unit, temporaryAttack: unit.temporaryAttack! }))

  for (const unit of state.board.filter(unit => unit.owner === actorSeat && unit.expiresAtTurnEnd && !unit.dying)) applyTriggeredDamage(state, unit, 0, undefined, true)

  for (const doggo of state.board.filter(unit => unit.card.Name === 'Догго' && (unit.doggoBuffs ?? 0) > 0 && !unit.dying)) {
    const amount = doggo.doggoBuffs!
    doggo.attack -= amount
    doggo.speed += amount
    doggo.health -= amount
    doggo.maxHealth -= amount
    doggo.doggoBuffs = 0
    if (doggo.health <= 0) {
      const owner = state.players[doggo.owner]!
      const burn = hasBurnTrait(doggo.card.Description ?? '') || burnsOnDeathFromField(doggo.card.Type, state.board)
      if ((owner.nextBurnToSave ?? 0) > 0) { owner.nextBurnToSave!--; owner.saved.push(doggo.card) }
      else if (burn) { owner.burned.push(doggo.card); if (doggo.owner === actorSeat) owner.burnedThisTurn = true; gainBurnTriggerTokens(state.board, doggo.owner) }
      else owner.discard.push(doggo.card)
      if (doggo.item) owner.discard.push(doggo.item)
      state.board.splice(state.board.indexOf(doggo), 1)
      queueSwarmRewards(state, doggo)
    }
  }
  for (const unit of state.board.filter(unit => unit.owner === actorSeat && unit.flippedTurns && !unit.dying)) {
    if (!flipTimerTicks(effectiveCardDescription(unit.card.Description ?? '', unit.item?.Description ?? ''))) continue
    const tick = tickFlipAtOwnerEnd(unit.health, unit.flippedTurns!)
    unit.flippedTurns = tick.flippedTurns
    if (tick.dies) applyTriggeredDamage(state, unit, 0, undefined, true)
  }
  player.mana = 0
  player.energy = 0
  if (movementIsBlocked(state.movementLock ?? null, actorSeat)) state.movementLock = null
  const nextSeat = 1 - actorSeat
  if (nextSeat === 0) state.round++
  state.current = nextSeat
  const nextPlayer = state.players[nextSeat]!
  const startEffects: StartTurnSource[] = []
  for (const unit of state.board) {
    const description = effectiveCardDescription(unit.card.Description ?? '', isShieldItem(unit.item) ? '' : unit.item?.Description ?? '')
    const effect = startTurnEffect(description)
    const isBunya = unit.card.Name === 'Буня' && unit.owner === nextSeat && !unit.dying
    const triggersEveryTurn = effect?.scope === 'every-turn' || /В начале каждого хода/iu.test(description)
    const triggersThisTurn = !unit.dying && (!unit.flippedTurns || unit.card.Name === 'Буня') && (unit.owner === nextSeat || triggersEveryTurn)
    if (!triggersThisTurn) continue
    if (isBunya || !effect && /В начале (?:вашего |каждого |своего )?хода/iu.test(description)) invalidCommand('UNSUPPORTED_EFFECT')
    if (!effect) continue
    if (effect.operations.some(operation => !['draw', 'take-top-discard', 'gain-mana', 'gain-energy', 'damage-player', 'move-self-forward', 'burn-hand-card', 'burn-hand-card-if-hand-limit-at-least', 'play-cheapest-creature-adjacent', 'shield-surrounding-creature', 'burn-weakest-creature', 'gamba-destroy-self', 'gamba-heal-allies-or-damage-enemies'].includes(operation.kind)) || !hasOnlySupportedStartTurnText(description, effect.operations.length)) invalidCommand('UNSUPPORTED_EFFECT')
    startEffects.push({ unitId: unit.id, cardName: unit.card.Name, owner: unit.owner, operations: effect.operations })
  }
  nextPlayer.played = false
  nextPlayer.burnedThisTurn = false
  for (const unit of state.board) {
    if (unit.owner === nextSeat) { unit.attacks = 0; unit.abilityUsed = false; if (unit.item?.Name === 'Щит') unit.shield = true }
    if (unit.owner === actorSeat && typeof unit.stunned === 'number') unit.stunned = Math.max(0, unit.stunned - 1)
  }
  const startEvents = resumeStartTurn(state, { sources: startEffects, sourceIndex: 0, operationIndex: 0, manaBonus: [0, 0], energyBonus: [0, 0] }, random)
  state.version++
  state.log.push(`${player.name} завершает ход.`)
  return { state, events: [...(discardCount ? [{ type: 'cards.discarded', seat: actorSeat, count: discardCount }] : []), ...endTurnEvents, { type: 'turn.ended', seat: actorSeat, nextSeat, round: state.round }, ...startEvents] }
}

function moveUnit(match: MatchState, actorSeat: number, data: Record<string, unknown>, random: () => number) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  if (Object.keys(data).length !== 2 || typeof data.unitId !== 'string' || !data.unitId || !data.to || typeof data.to !== 'object' || Array.isArray(data.to)) invalidCommand('INVALID_COMMAND')
  const to = data.to as Record<string, unknown>
  if (Object.keys(to).length !== 2 || !Number.isInteger(to.row) || !Number.isInteger(to.col) || Number(to.row) < 0 || Number(to.row) > 4 || Number(to.col) < 0 || Number(to.col) > 4) invalidCommand('INVALID_COMMAND')
  const unit = match.board.find(candidate => candidate.id === data.unitId)
  if (!unit) invalidCommand('UNIT_NOT_FOUND')
  if (!unitIsActive(match, unit, actorSeat)) invalidCommand('UNIT_CANNOT_MOVE')
  if (movementIsBlocked(match.movementLock ?? null, match.current)) invalidCommand('MOVEMENT_BLOCKED')
  if (unitMovementBlocked(unit) || !unitCanMoveAndAttack(unit, match.board)) invalidCommand('UNIT_CANNOT_MOVE')
  const { row, col } = to as { row: number; col: number }
  if (!canMoveTo(unit.row, unit.col, row, col, unit.item?.Name === 'Банни хоп') || match.board.some(other => other.row === row && other.col === col)) invalidCommand('INVALID_TARGET')
  const cost = effectiveUnitSpeed({ ...unit, shield: unit.shield ?? false })
  if (match.players[actorSeat]!.energy < cost) invalidCommand('NOT_ENOUGH_ENERGY')
  const state = structuredClone(match)
  const moved = state.board.find(candidate => candidate.id === unit.id)!
  const from = { row: moved.row, col: moved.col }
  const movementSpeed = effectiveUnitSpeed({ ...unit, shield: unit.shield ?? false })
  moved.row = row
  moved.col = col
  state.players[actorSeat]!.energy -= cost
  const turretHits = applyMovementTriggers(state, moved, from, movementSpeed)
  state.version++
  state.log.push(`«${moved.card.Name}» передвигается.${turretHits ? ` Турель наносит ${2 * turretHits} урона.` : ''}`)
  return { state, events: [{ type: 'unit.moved', unitId: moved.id, from, to: { row, col } }] }
}

function applyMovementTriggers(state: MatchState, moved: BoardUnit, from: { row: number; col: number }, speed = effectiveUnitSpeed({ ...moved, shield: Boolean(moved.shield) }), triggerTurret = true) {
  if (moved.card.Type !== 0) return 0
  applyMovementStateTriggers(state, moved, from.row, state.current, speed, unit => applyTriggeredDamage(state, unit, 0, undefined, true), !triggerTurret)
  let turretHits = 0
  if (triggerTurret) for (const turret of state.board.filter(candidate => candidate.card.Name === 'Турель' && !candidate.dying)) {
    if (canMoveTo(turret.row, turret.col, from.row, from.col) || !canMoveTo(turret.row, turret.col, moved.row, moved.col)) continue
    applyTriggeredDamage(state, moved, 2)
    turretHits++
    if (!state.board.includes(moved) || moved.health <= 0) break
  }
  return turretHits
}

function deathEffectsForUnit(unit: BoardUnit) {
  const cardEffects = rulesForCard(unit.card.Name).death ?? []
  const itemEffects = unit.item ? rulesForCard(unit.item.Name).death ?? [] : []
  const effects = [...cardEffects, ...itemEffects]
  if (effects.some(effect => !['birdli-flip', 'newcomers', 'damage-weaken-target', 'burn-flipped-card', 'save-deck-cards-by-cost', 'take-item-from-deck', 'damage-player', 'heal-player', 'damage-adjacent-creatures', 'damage-adjacent-buildings', 'draw', 'save-self', 'take-discard-top-except-self', 'take-pile-card', 'buff-surrounding-allied-creatures', 'repeat-entry-selection', 'return-equipped-item-to-deck'].includes(effect.kind)) || !cardEffects.length && /(?:^|\r?\n)\s*Посмертно\s*:/iu.test(unit.card.Description ?? '') || unit.item && !itemEffects.length && /Посмертно\s*:/iu.test(unit.item.Description ?? '')) invalidCommand('UNSUPPORTED_EFFECT')
  if (effects.some(effect => effect.kind === 'birdli-flip') && (unit.card.Name !== 'Бёрдли' || unit.card.Type !== 0 || unit.card.Description !== 'Вход: Ваша следующая гамба имеет +2.\nПосмертно: Бёрдли вместо сброса получает эффект Переворот 3, только по окончанию этого эффекта он сбрасывается')) invalidCommand('UNSUPPORTED_EFFECT')
  if (effects.some(effect => effect.kind === 'return-equipped-item-to-deck') && (unit.card.Name !== 'Янгуша' || unit.card.Type !== 0 || unit.card.Description !== 'Вход: Возьмите предмет.\r\nПосмертно: Отправляет свой предмет на верх КД.')) invalidCommand('UNSUPPORTED_EFFECT')
  return effects
}

function applyDeathEffects(state: MatchState, unit: BoardUnit, effects: ReturnType<typeof deathEffectsForUnit>, burned: boolean, random: () => number) {
  const owner = state.players[unit.owner]!
  const passes = deathEffectPasses(unit, state.board)
  for (let pass = 0; pass < passes; pass++) for (const effect of effects) {
    if (effect.kind === 'birdli-flip') {
      // The first lethal hit is converted to a timed flip before this resolver runs.
    } else if (effect.kind === 'newcomers') {
      if (state.round < 10) owner.energy += 3
      else {
        const unitIds = owner.hand.filter(card => card.Type === 2 && card.instanceId).map(card => card.instanceId!)
        if (unitIds.length) {
          const choice = { id: `choice_${state.id}_${state.version + 1}_newcomers_${unit.id}`, owner: unit.owner, kind: 'spell-save-hand' as const, sourceUnitId: unit.id, sourceCardName: unit.card.Name, unitIds, count: 1 as const }
          if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
          else state.pendingChoice = choice
        }
      }
    } else if (effect.kind === 'burn-flipped-card') {
      const targets = state.board.filter(target => target.id !== unit.id && target.flippedTurns && !target.dying)
      if (targets.length === 1) applyTriggeredDamage(state, targets[0]!, 0, undefined, true, true, 0, false, random)
      else if (targets.length > 1) {
        const choice = { id: `choice_${state.id}_${state.version + 1}_burn_flipped_${unit.id}`, owner: unit.owner, kind: 'death-burn-flipped' as const, sourceUnitId: unit.id, sourceCardName: unit.card.Name, unitIds: targets.map(target => target.id) }
        if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
        else state.pendingChoice = choice
      }
    } else if (effect.kind === 'damage-weaken-target') {
      const unitIds = state.board.filter(target => target.id !== unit.id && !target.dying).map(target => target.id)
      const playerTarget = unit.row === (unit.owner === 0 ? 0 : 4)
      if (unitIds.length || playerTarget) {
        const choice = { id: `choice_${state.id}_${state.version + 1}_hedgehog_${unit.id}`, owner: unit.owner, kind: 'death-weaken-target' as const, sourceUnitId: unit.id, sourceCardName: unit.card.Name, unitIds, playerTarget }
        if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
        else state.pendingChoice = choice
      }
    } else if (effect.kind === 'save-deck-cards-by-cost') {
      const unitIds = owner.deck.filter(card => card.instanceId && Number(card.Cost ?? 0) <= effect.totalCost).map(card => card.instanceId!)
      if (unitIds.length) {
        const choice = { id: `choice_${state.id}_${state.version + 1}_save_deck_${unit.id}`, owner: unit.owner, kind: 'death-save-deck-cards' as const, sourceUnitId: unit.id, sourceCardName: unit.card.Name, unitIds, count: effect.count, totalCost: effect.totalCost }
        if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
        else state.pendingChoice = choice
      }
    } else if (effect.kind === 'take-item-from-deck') {
      const card = takeAndShufflePileCard(owner.deck, 1, random)
      if (card?.instanceId) {
        owner.hand.push(card)
        const choice = { id: `choice_${state.id}_${state.version + 1}_intivi_${unit.id}`, owner: unit.owner, kind: 'death-intivi' as const, sourceUnitId: unit.id, sourceCardName: unit.card.Name, itemInstanceId: card.instanceId, itemName: card.Name }
        if (state.pendingChoice) (state.queuedChoices ??= []).push(choice)
        else state.pendingChoice = choice
      }
    } else if (effect.kind === 'draw') {
      for (let index = 0; index < effect.count && owner.deck.length; index++) owner.hand.push(owner.deck.shift()!)
    } else if (effect.kind === 'take-pile-card') {
      const card = takePileCard(owner[effect.source], effect.source, effect.from, effect.cardType)
      if (card) owner.hand.push(card)
    } else if (effect.kind === 'repeat-entry-selection') {
      resolveWismuthSearch(state, unit.owner, unit.id, unit.card.Name, random)
    } else if (effect.kind === 'return-equipped-item-to-deck') {
      // The attached item is moved before death effects run.
    } else if (effect.kind === 'buff-surrounding-allied-creatures') {
      for (const target of state.board.filter(target => target.id !== unit.id && target.owner === unit.owner && target.card.Type === 0 && !target.dying && Math.max(Math.abs(target.row - unit.row), Math.abs(target.col - unit.col)) === 1)) {
        Object.assign(target, applyCombatStatChanges(target, effect.attack, 0))
        Object.assign(target, applyEntryNeighborBuff(target, { health: effect.health }))
      }
    } else if (effect.kind === 'take-discard-top-except-self') {
      for (let index = 0; index < effect.count; index++) {
        const card = takeTopDiscard(owner.discard, unit.card)
        if (!card) break
        owner.hand.push(card)
      }
    } else if (effect.kind === 'save-self') {
      const pile = burned ? owner.burned : owner.discard
      const index = pile.lastIndexOf(unit.card)
      if (index >= 0) owner.saved.push(pile.splice(index, 1)[0]!)
    } else if (effect.kind === 'heal-player') owner.health = Math.min(45, owner.health + effect.amount)
    else if (effect.kind === 'damage-player') {
      const targetSeat = 1 - unit.owner
      const player = state.players[targetSeat]!
      player.health = Math.max(0, player.health - effect.amount)
      if (!player.health) { state.status = 'finished'; state.winnerUserId = state.players[winnerWhenPlayerFalls(targetSeat as 0 | 1)]!.userId; state.endReason = 'death' }
    } else if (effect.kind === 'damage-adjacent-creatures' || effect.kind === 'damage-adjacent-buildings') {
      const targetType = effect.kind === 'damage-adjacent-creatures' ? 0 : 3
      for (const adjacent of state.board.filter(target => target.id !== unit.id && target.card.Type === targetType && !target.dying && !target.flippedTurns && Math.abs(target.row - unit.row) + Math.abs(target.col - unit.col) === 1)) applyTriggeredDamage(state, adjacent, effect.amount, unit, false, false, 0, false, random)
    } else invalidCommand('UNSUPPORTED_EFFECT')
  }
}

function applyTriggeredDamage(state: MatchState, target: BoardUnit, amount: number, source?: BoardUnit, forceDestroy = false, forceBurn = false, flipOnKill = 0, forceBurnItem = false, random: () => number = Math.random) {
  if (target.dying) return
  if (!forceDestroy && target.card.Name === 'Вадим' && !target.flippedTurns && source?.card.Type === 0 && effectiveUnitAttack(source) <= state.players[target.owner]!.saved.length) return
  if (!forceDestroy && target.card.Name === 'Глифид-Преторианец' && !target.flippedTurns) return
  if (!forceDestroy && target.flippedTurns && target.card.Name === 'Буня') {
    if (target.shield) target.shield = false
    else target.flippedTurns = Math.max(0, target.flippedTurns - 1)
    if (!target.flippedTurns) target.health = Math.max(1, target.maxHealth)
    return
  }
  const before = target.health
  const result = forceDestroy
    ? { state: { health: 0, shield: false }, absorbed: false, lethal: true }
    : applyUnitDamage({ health: target.health, shield: Boolean(target.shield), dying: Boolean(target.dying), flippedTurns: target.flippedTurns ?? 0 }, amount, incomingDamageReduction(state.board, target.owner, target.card.Type))
  target.health = result.state.health
  target.shield = result.state.shield
  if (result.absorbed) return
  const dealt = Math.max(0, before - target.health)
  if (!forceDestroy && dealt && target.card.Name === 'Джон') { target.health += dealt * 2; target.maxHealth += dealt * 2 }
  if (!result.lethal || target.health > 0) return
  if (target.card.Name === 'Бёрдли' && !target.birdliDeathFlip) { target.health = 0; target.flippedTurns = 3; target.birdliDeathFlip = true; return }
  if (!forceDestroy && flipOnKill > 0) { target.flippedTurns = flipOnKill; return }
  const effects = deathEffectsForUnit(target)
  target.dying = true
  target.flippedTurns = 0
  const reward = source ? killRewardForCard(source.card.Name, source.owner, target.owner, target.card.Type) : null
  if (reward && !source!.dying) { source!.attack += reward.attack; if (reward.shield) source!.shield = true }
  const owner = state.players[target.owner]!
  const burn = forceBurn || hasBurnTrait(target.card.Description ?? '') || burnsOnDeathFromField(target.card.Type, state.board) || source?.card.Name === 'Рокочущий рыцарь' && target.card.Type === 0
  if (burn) burnPileCard(state, target.owner, target.card)
  else owner.discard.push(target.card)
  if (target.item) {
    if (effects.some(effect => effect.kind === 'return-equipped-item-to-deck')) owner.deck.unshift(target.item)
    else if (forceBurnItem || hasBurnTrait(target.item.Description ?? '')) burnPileCard(state, target.owner, target.item)
    else owner.discard.push(target.item)
  }
  applyDeathEffects(state, target, effects, burn, random)
  state.board.splice(state.board.indexOf(target), 1)
  queueSwarmRewards(state, target)
}

function canResolveTriggeredEffect(state: MatchState, target: BoardUnit, amount: number, source: BoardUnit, forceDestroy = false) {
  const probe = structuredClone(state)
  try {
    applyTriggeredDamage(probe, probe.board.find(unit => unit.id === target.id)!, amount, probe.board.find(unit => unit.id === source.id), forceDestroy)
    return true
  } catch (error) {
    if ((error as { code?: string }).code === 'UNSUPPORTED_EFFECT') return false
    throw error
  }
}

function settleTauCannonThresholds(state: MatchState) {
  for (const unit of [...state.board]) {
    if (unit.card.Type !== 0 || !isTauCannon(unit.item) || unit.dying || unit.attack < 5) continue
    applyTriggeredDamage(state, state.board.find(candidate => candidate.id === unit.id)!, 0, undefined, true, false, 0, true)
    state.log.push('«Тау-пушка» сжигается, а существо погибает при атаке 5 или выше.')
  }
}

function applyCardPlayFieldEffects(state: MatchState, seat: number, type: number) {
  for (const unit of state.board.filter(unit => unit.owner === seat && !unit.dying && !unit.flippedTurns)) {
    if (unit.card.Name === 'Глойньки') {
      if (unit.card.Description !== 'Постоянно: Получает +1⚔️ +1❤️ когда вы разыгрываете карту до конца хода') invalidCommand('UNSUPPORTED_EFFECT')
      unit.attack++
      unit.health++
      unit.maxHealth++
      unit.cardPlayBuffs = (unit.cardPlayBuffs ?? 0) + 1
    } else if (unit.card.Name === 'Жемчуг Санеса' && (type === 1 || type === 2)) {
      if (unit.card.Description !== 'Досягаемость\nПостоянно: Получает +1❤️ каждый раз когда вы разыгрываете заклинание или предмет') invalidCommand('UNSUPPORTED_EFFECT')
      unit.health++
      unit.maxHealth++
    }
  }
}

function settleCommand<T extends { state: MatchState }>(result: T): T {
  settleTauCannonThresholds(result.state)
  for (const [seat, player] of result.state.players.entries()) {
    if (player.freePlayCardIds) player.freePlayCardIds = player.freePlayCardIds.filter(id => player.hand.some(card => card.instanceId === id))
    if (!player.depressiveHandLimit) continue
    if (result.state.board.some(unit => unit.owner === seat && unit.card.Name === 'Депрессивная Жопа')) player.limit = 1
    else {
      const lock = player.depressiveHandLimit
      const turnIndex = (result.state.round - 1) * 2 + result.state.current
      if (lock.override && lock.override.expiresAt > turnIndex) {
        player.temporaryLimitOverride = lock.override
        player.limit = lock.override.value
      } else {
        player.limit = Math.max(1, (lock.override?.previous ?? lock.previousLimit) + (player.temporaryLimitExpirations?.length ?? 0))
      }
      delete player.depressiveHandLimit
    }
  }
  promoteQueuedChoice(result.state)
  return result
}

function attackUnit(match: MatchState, actorSeat: number, data: Record<string, unknown>, random: () => number) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  if (Object.keys(data).length !== 2 || typeof data.unitId !== 'string' || !data.unitId || typeof data.targetUnitId !== 'string' || !data.targetUnitId) invalidCommand('INVALID_COMMAND')
  const attacker = match.board.find(unit => unit.id === data.unitId)
  const defender = match.board.find(unit => unit.id === data.targetUnitId)
  if (!attacker || !defender || attacker === defender) invalidCommand('INVALID_TARGET')
  if (!unitIsActive(match, attacker, actorSeat) || !unitCanMoveAndAttack(attacker, match.board)) invalidCommand('UNIT_CANNOT_ATTACK')
  const attackerDescription = effectiveCardDescription(attacker.card.Description ?? '', attacker.item?.Description ?? '')
  const defenderDescription = effectiveCardDescription(defender.card.Description ?? '', defender.item?.Description ?? '')
  const reach = attackerDescription.includes('Досягаемость')
  if (defender.dying || !canAttackBoardCard(attacker.card.Name, defenderDescription, Boolean(defender.flippedTurns), reach) || !canAttackTarget(attacker.card.Name, attacker.owner, defender.owner, attackerDescription.includes('Безопасность'))) invalidCommand('INVALID_TARGET')
  const attackLimit = hasTemporaryRage(attackerDescription, Boolean(attacker.temporaryRage)) ? 2 : 1
  if ((attacker.attacks ?? 0) >= attackLimit) invalidCommand('ATTACKS_EXHAUSTED')
  if (!canMoveTo(attacker.row, attacker.col, defender.row, defender.col, reach)) invalidCommand('OUT_OF_RANGE')
  const hasAudit = match.board.some(unit => unit.owner === actorSeat && unit.card.Name === 'Журнал аудита' && !unit.dying)
  if (!defender.flippedTurns && defenderDescription.includes('Невидимость') && !hasAudit) invalidCommand('INVALID_TARGET')

  const state = structuredClone(match)
  const attackingUnit = state.board.find(unit => unit.id === attacker.id)!
  const defendingUnit = state.board.find(unit => unit.id === defender.id)!
  const targetNotNegated = !defendingUnit.flippedTurns && defendingUnit.nextAttackNegated
  const crownOperations = [...(rulesForCard(attackingUnit.card.Name).crown ?? []), ...(attackingUnit.item ? rulesForCard(attackingUnit.item.Name).crown ?? [] : [])]
  const v1Crown = attackingUnit.card.Name === 'V1' && attackerDescription.replace(/\r\n/gu, '\n') === 'Досягаемость\nКоронный: Восстанавливает себе всё здоровье и восстанавливает здоровье владельца на величину равную своей атаке.\nНе работает на атаку с досягаемостью.\nПостоянно: Получает 1 за каждую убитую им карту\nХорни 10: Постоянно: Эффект коронный работает и на атаку с досягаемостью.'
  const pantlessCrown = attackingUnit.card.Name === 'Pantlessterrorist' && attackerDescription === 'Коронный: Наносит двойной урон.\nЛовушка: Не наносит ответного урона.'
  const hasAttackTriggers = crownOperations.length || /(?:^|\r?\n)\s*Коронный\s*:/iu.test(attackerDescription)
  const trapOperations = [...(rulesForCard(defendingUnit.card.Name).trap ?? []), ...(defendingUnit.item ? rulesForCard(defendingUnit.item.Name).trap ?? [] : [])]
  const hasTrapTriggers = !defendingUnit.flippedTurns && (trapOperations.length || /(?:^|\r?\n)\s*Ловушка\s*:/iu.test(defenderDescription))
  const pantlessTrap = defendingUnit.card.Name === 'Pantlessterrorist' && defenderDescription === 'Коронный: Наносит двойной урон.\nЛовушка: Не наносит ответного урона.'
  const unsupportedCrown = hasAttackTriggers && !v1Crown && !pantlessCrown && (!crownOperations.length || crownOperations.some(operation => !['draw', 'gain-mana', 'gain-black-token', 'increase-hand-limit', 'stun-target', 'heal-player', 'heal-attacker', 'damage-player', 'damage-target', 'damage-surrounding-creatures', 'destroy-self', 'flip-attacker', 'destroy-target-item-or-building', 'destroy-target', 'destroy-target-if-damaged', 'return-attacker-to-hand', 'viskas-choice', 'play-saved-spell', 'gamba-damage-or-heal-target', 'burn-attacker-and-target', 'move-target-adjacent', 'move-target-sideways', 'move-target-backward', 'move-target-any'].includes(operation.kind)) || !hasOnlySupportedCrownText(attackerDescription, crownOperations))
  const unsupportedTrap = hasTrapTriggers && !pantlessTrap && (!trapOperations.length || trapOperations.some(operation => !['damage-attacker', 'damage-attacking-player', 'destroy-attacker', 'take-control-attacker', 'give-item-to-attacker-and-buff'].includes(operation.kind)) || !hasOnlySupportedTrapText(defenderDescription, trapOperations))
  if (!targetNotNegated && (unsupportedCrown || unsupportedTrap)) invalidCommand('UNSUPPORTED_EFFECT')

  const lethalUnits: BoardUnit[] = []
  const lethalSources = new Map<string, BoardUnit>()
  const damageUnit = (target: BoardUnit, source: BoardUnit, amount: number) => {
    if (target.card.Name === 'Вадим' && !target.flippedTurns && source.card.Type === 0 && effectiveUnitAttack(source) <= state.players[target.owner]!.saved.length) return 0
    if (target.card.Name === 'Глифид-Преторианец' && !target.flippedTurns && (source.col !== target.col || source.row !== target.row + (target.owner === 0 ? 1 : -1))) return 0
    if (target.flippedTurns && target.card.Name === 'Буня') {
      if (target.shield) target.shield = false
      else target.flippedTurns = Math.max(0, target.flippedTurns - 1)
      if (!target.flippedTurns) target.health = Math.max(1, target.maxHealth)
      return 0
    }
    const healthBeforeDamage = target.health
    const result = applyUnitDamage({ health: target.health, shield: Boolean(target.shield), dying: Boolean(target.dying), flippedTurns: target.flippedTurns ?? 0 }, amount, incomingDamageReduction(state.board, target.owner, target.card.Type))
    target.health = result.state.health
    target.shield = result.state.shield
    const dealt = result.absorbed ? 0 : Math.max(0, amount - incomingDamageReduction(state.board, target.owner, target.card.Type))
    if (dealt && target.card.Name === 'Джон') { target.health += dealt * 2; target.maxHealth += dealt * 2 }
    if (target.health <= 0 && source === attackingUnit && target === defendingUnit && source.card.Name === 'PGM Peridot') target.flippedTurns = 2
    else if (target.health <= 0 && !lethalUnits.includes(target)) { lethalUnits.push(target); lethalSources.set(target.id, source) }
    if (dealt && rulesForCard(source.item?.Name ?? '').damageOpponentWithCombat) {
      const player = state.players[1 - source.owner]!
      player.health -= dealt
      if (player.health <= 0) { state.status = 'finished'; state.winnerUserId = state.players[winnerWhenPlayerFalls((1 - source.owner) as 0 | 1)]!.userId; state.endReason = 'combat' }
    }
    return result.absorbed ? 0 : Math.max(0, healthBeforeDamage - result.state.health)
  }

  const extraSplash = targetNotNegated ? 0 : attackingUnit.nextAttackSplashDamage ?? 0
  if (targetNotNegated) defendingUnit.nextAttackNegated = false
  else attackingUnit.nextAttackSplashDamage = 0
  if (!targetNotNegated && shouldDealCombatDamage(attackingUnit.owner, defendingUnit.owner)) {
    const amount = attackDamageForCard(attackingUnit.card.Name, effectiveUnitAttack(attackingUnit), attackingUnit.item?.Name, false, defendingUnit)
    damageUnit(defendingUnit, attackingUnit, amount)
    const defenderHasAudit = state.board.some(unit => unit.owner === defendingUnit.owner && unit.card.Name === 'Журнал аудита' && !unit.dying)
    if (!defendingUnit.flippedTurns && canCounterattack(defendingUnit.card.Name, defendingUnit.card.Type === 0, attackWasDiagonal(attackingUnit.row, attackingUnit.col, defendingUnit.row, defendingUnit.col), reach, defenderDescription.includes('Досягаемость'), defenderHasAudit, defendingUnit.item?.Name) && !(attackingUnit.flippedTurns && canActWhileFlipped(attackerDescription))) {
      const counterDamage = attackDamageForCard(defendingUnit.card.Name, effectiveUnitAttack(defendingUnit), defendingUnit.item?.Name, true, attackingUnit)
      damageUnit(attackingUnit, defendingUnit, counterDamage)
    }
    if (extraSplash) {
      for (const target of state.board.filter(unit => unit.card.Type === 0 && !unit.dying && unit.row === defendingUnit.row && Math.abs(unit.col - defendingUnit.col) <= 1)) damageUnit(target, attackingUnit, extraSplash)
    }
  }
  if (!targetNotNegated && (crownOperations.length || v1Crown)) applySimpleCrown(state, attackingUnit, defendingUnit, reach && attackWasDiagonal(attackingUnit.row, attackingUnit.col, defendingUnit.row, defendingUnit.col), random)
  if (!targetNotNegated && hasTrapTriggers) for (const operation of trapOperations) {
    if (operation.kind === 'damage-attacker') damageUnit(attackingUnit, defendingUnit, operation.amount)
    else if (operation.kind === 'destroy-attacker') {
      attackingUnit.health = 0
      if (!lethalUnits.includes(attackingUnit)) { lethalUnits.push(attackingUnit); lethalSources.set(attackingUnit.id, defendingUnit) }
    }
    else if (operation.kind === 'take-control-attacker') attackingUnit.owner = defendingUnit.owner
    else if (operation.kind === 'give-item-to-attacker-and-buff' && transferEquippedItem(state, attackingUnit, defendingUnit)) defendingUnit.attack += operation.amount
    else if (operation.kind === 'damage-attacking-player') {
      const targetSeat = attackingUnit.owner as 0 | 1
      const target = state.players[targetSeat]!
      target.health = Math.max(0, target.health - operation.amount)
      if (!target.health) {
        state.status = 'finished'
        state.winnerUserId = state.players[winnerWhenPlayerFalls(targetSeat)]!.userId
        state.endReason = 'combat'
      }
    }
  }
  attackingUnit.attacks = (attackingUnit.attacks ?? 0) + 1

  const dead = lethalUnits.filter(unit => state.board.includes(unit) && unit.health <= 0 && !unit.dying)
  for (const unit of dead) {
    deathEffectsForUnit(unit)
    unit.dying = true
  }
  for (const unit of dead) {
    const owner = state.players[unit.owner]!
    const burn = hasBurnTrait(unit.card.Description ?? '') || burnsOnDeathFromField(unit.card.Type, state.board) || (unit.card.Type === 0 && (unit.id === attackingUnit.id ? defendingUnit.card.Name : attackingUnit.card.Name) === 'Рокочущий рыцарь')
    const effects = deathEffectsForUnit(unit)
    if (effects.some(effect => effect.kind === 'birdli-flip') && !unit.birdliDeathFlip) {
      unit.flippedTurns = 3
      unit.birdliDeathFlip = true
      unit.dying = false
      continue
    }
    if (burn) burnPileCard(state, unit.owner, unit.card)
    else owner.discard.push(unit.card)
    if (unit.item) {
      if (effects.some(effect => effect.kind === 'return-equipped-item-to-deck')) owner.deck.unshift(unit.item)
      else if (hasBurnTrait(unit.item.Description ?? '')) burnPileCard(state, unit.owner, unit.item)
      else owner.discard.push(unit.item)
    }
    applyDeathEffects(state, unit, effects, burn, random)
    const killer = lethalSources.get(unit.id) ?? (unit.id === defendingUnit.id ? attackingUnit : defendingUnit)
    const reward = killRewardForCard(killer.card.Name, killer.owner, unit.owner, unit.card.Type)
    if (reward && !killer.dying) { killer.attack += reward.attack; if (reward.shield) killer.shield = true }
    state.board.splice(state.board.indexOf(unit), 1)
    queueSwarmRewards(state, unit)
  }

  state.version++
  state.log.push(`«${attacker.card.Name}» атакует «${defender.card.Name}».`)
  return { state, events: [{ type: 'unit.attacked', attackerUnitId: attacker.id, targetUnitId: defender.id }] }
}

function attackPlayer(match: MatchState, actorSeat: number, data: Record<string, unknown>) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  if (Object.keys(data).length !== 1 || typeof data.unitId !== 'string' || !data.unitId) invalidCommand('INVALID_COMMAND')
  const unit = match.board.find(candidate => candidate.id === data.unitId)
  if (!unit) invalidCommand('UNIT_NOT_FOUND')
  if (!unitIsActive(match, unit, actorSeat) || !unitCanMoveAndAttack(unit, match.board)) invalidCommand('UNIT_CANNOT_ATTACK')
  if (unit.card.Type !== 0 || unit.row !== (actorSeat === 0 ? 0 : 4) || rulesForCard(unit.card.Name).cannotDamagePlayerDirectly || rulesForCard(unit.item?.Name ?? '').cannotDamagePlayerDirectly) invalidCommand('INVALID_TARGET')
  const description = effectiveCardDescription(unit.card.Description ?? '', unit.item?.Description ?? '')
  if (hasTemporaryRage(description, Boolean(unit.temporaryRage)) ? (unit.attacks ?? 0) >= 2 : (unit.attacks ?? 0) >= 1) invalidCommand('ATTACKS_EXHAUSTED')
  const crownOperations = [...(rulesForCard(unit.card.Name).crown ?? []), ...(unit.item ? rulesForCard(unit.item.Name).crown ?? [] : [])]
  const v1Crown = unit.card.Name === 'V1' && description.replace(/\r\n/gu, '\n') === 'Досягаемость\nКоронный: Восстанавливает себе всё здоровье и восстанавливает здоровье владельца на величину равную своей атаке.\nНе работает на атаку с досягаемостью.\nПостоянно: Получает 1 за каждую убитую им карту\nХорни 10: Постоянно: Эффект коронный работает и на атаку с досягаемостью.'
  const pantlessCrown = unit.card.Name === 'Pantlessterrorist' && description === 'Коронный: Наносит двойной урон.\nЛовушка: Не наносит ответного урона.'
  if (!v1Crown && !pantlessCrown && (crownOperations.length || /(?:^|\r?\n)\s*Коронный\s*:/iu.test(description)) && (!crownOperations.length || crownOperations.some(operation => !['draw', 'gain-mana', 'gain-black-token', 'increase-hand-limit', 'stun-target', 'heal-player', 'heal-attacker', 'damage-player', 'damage-target', 'damage-surrounding-creatures', 'destroy-self', 'flip-attacker', 'destroy-target-item-or-building', 'destroy-target', 'destroy-target-if-damaged', 'return-attacker-to-hand', 'viskas-choice', 'play-saved-spell', 'gamba-damage-or-heal-target', 'burn-attacker-and-target', 'move-target-adjacent', 'move-target-sideways', 'move-target-backward', 'move-target-any'].includes(operation.kind)) || !hasOnlySupportedCrownText(description, crownOperations))) invalidCommand('UNSUPPORTED_EFFECT')

  const state = structuredClone(match)
  const attacker = state.board.find(candidate => candidate.id === unit.id)!
  const targetSeat = (1 - actorSeat) as 0 | 1
  const damage = attackDamageForCard(attacker.card.Name, effectiveUnitAttack(attacker), attacker.item?.Name)
  state.players[targetSeat]!.health = Math.max(0, state.players[targetSeat]!.health - damage)
  attacker.attacks = (attacker.attacks ?? 0) + 1
  attacker.nextAttackSplashDamage = 0
  if (state.players[targetSeat]!.health <= 0) {
    state.status = 'finished'
    state.winnerUserId = state.players[winnerWhenPlayerFalls(targetSeat)]!.userId
    state.endReason = 'combat'
  }
  applySimpleCrown(state, attacker)
  state.version++
  state.log.push(`«${attacker.card.Name}» атакует игрока ${state.players[targetSeat]!.name}.`)
  return { state, events: [{ type: 'player.attacked', attackerUnitId: attacker.id, targetSeat, damage }] }
}

function useAbility(match: MatchState, actorSeat: number, data: Record<string, unknown>, random: () => number) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  if (Object.keys(data).some(key => !['unitId', 'abilityIndex', 'scoreAdjustment'].includes(key)) || !Object.hasOwn(data, 'unitId') || !Object.hasOwn(data, 'abilityIndex') || typeof data.unitId !== 'string' || !data.unitId || !Number.isInteger(data.abilityIndex) || Number(data.abilityIndex) < 0 || Number(data.abilityIndex) > 32) invalidCommand('INVALID_COMMAND')
  const unit = match.board.find(candidate => candidate.id === data.unitId)
  if (!unit) invalidCommand('UNIT_NOT_FOUND')
  const index = Number(data.abilityIndex)
  const description = effectiveCardDescription(unit.card.Description ?? '', unit.item?.Description ?? '')
  if (!unitIsActive(match, unit, actorSeat) || unit.flippedTurns && canActWhileFlipped(description)) invalidCommand('UNIT_CANNOT_USE_ABILITY')
  if (unit.abilityUsed && !isRepeatableAbility(description, index)) invalidCommand('ABILITY_ALREADY_USED')
  const operation = targetedAbilityOperation(description, index)
  const abilitySelfDestruct = operation?.kind === 'destroy-self'
  const abilityHeal = operation?.kind === 'heal-target' && operation.targetType === 'creature' ? operation : null
  const suzieDamage = unit.card.Name === 'Сьюзи' && unit.card.Description === 'Способность 5: Наносит 8 урона выбранной цели.'
  const gersonDamage = unit.card.Name === 'Герсон Бум' && unit.card.Type === 0 && unit.card.Description === 'Досягаемость Щит\nПостоянно: Если на поле есть союзная Сьюзи, получает:\nСпособность 8⭐: Наносит 15 урона и сжигается'
  const abilityDamage = operation?.kind === 'damage-target' && index === 0 && (suzieDamage || gersonDamage) ? operation : null
  const abilityPutTargetOnDeck = operation?.kind === 'put-target-on-deck' && index === 0 && unit.card.Type === 3 && unit.card.Name === 'Закулисье' && unit.card.Description === 'Способность 5⭐: Выбранное существо отправляется наверх КД владельца.' ? operation : null
  const abilityLockMovement = operation?.kind === 'lock-movement-next-turn' && index === 0 && unit.card.Name === 'Noovse' && unit.card.Description === 'Способность 6⭐: На следующем ходу все существа не могут передвигаться до начала вашего следующего хода.' ? operation : null
  const abilityLucioHealth = operation?.kind === 'buff-allied-health' && index === 0 && unit.card.Name === 'Лусио' && unit.card.Description === 'Способность 10: Все ваши существа получают 10 до начала вашего следующего хода.' ? operation : null
  const abilityDrawOrLimit = operation?.kind === 'draw-or-increase-hand-limit' && index === 0 && unit.card.Type === 3 && unit.card.Name === 'Айсберг' && unit.card.Description === 'Постоянно: Когда вы сжигаете карту, то получает 1 ⚫\nСпособность 1 ⚫🔁: Возьмите карту или увеличьте лимит карт на 1 до конца следующего хода.' ? operation : null
  const abilitySacrificeBuilding = operation?.kind === 'sacrifice-building-for-attack' && index === 0 && unit.card.Type === 0 && unit.card.Name === 'Биби' && unit.card.Description === 'Способность 0⭐: Уничтожает ваше здание что бы дать получить +4⚔️ до конца хода.' ? operation : null
  const abilityGamba = operation?.kind === 'gamba-destroy-or-gain-mana' && index === 0 && unit.card.Type === 0 && unit.card.Name === 'Фанат геншина' && unit.card.Description?.replace(/\r\n/gu, '\n') === 'Способность 0: Гамба:\n1-3 - умирает\n4-6 - получите 3 маны.' ? operation : null
  const abilityDraw = index === 0 && unit.card.Type === 0 && unit.card.Name === 'Генератор потех' && unit.card.Description?.replace(/\r\n/gu, '\n') === 'Невидимость\nСпособность 2⭐: Возьмите карту\nСжигается' && abilityDrawCount(description, index) === 1
  const abilityConveyor = index === 0 && unit.card.Type === 3 && unit.card.Name === 'Конвейерное производство' && unit.card.Description?.replace(/\r\n/gu, '\n') === 'Способность 1⭐: Сбросьте 1 карту, сожгите 1 карту, сберегите 1 карту, возьмите 1 карту.'
  const abilityLibrarian = index === 0 && unit.card.Type === 0 && unit.card.Name === 'Библиотекарь' && unit.card.Description?.replace(/\r\n/gu, '\n').trimEnd() === 'Способность N⭐: Если вы потратили 1 ману, то вытащите любую обычную карту, если 2 любую редкую карту, если 4 любую легендарную карту из КД, КС. \nПостоянно: Гамба: Если вы вытаскиваете карту при помощи Библиотекаря.\n1-3 - Вытащенная карта сжигается.\n4-6 - Ничего не происходит.'
  const abilityText = abilityDescriptions(description)[index] ?? ''
  const tauCannonAbilityIndex = abilityDescriptions(unit.card.Description ?? '').length
  const tauCannonAbility = unit.card.Type === 0 && isTauCannon(unit.item) && index === tauCannonAbilityIndex && abilityDescriptions(unit.item!.Description ?? '')[0] === abilityText
  const multiTargetText = /^Способность[^:]*:\s*(?:Нанесите\s+\d+\s+урона?\s+(?:трём|трем|двум|двумя|\d+)\s+выбранным\s+разным\s+цел(?:ям|я)|Восстановите\s+\d+\s+здоровья?\s+(?:трём|трем|двум|двумя|\d+)\s+выбранным\s+разным\s+цел(?:ям|я))\.?$/iu.test(abilityText)
  const abilityDamageTargets = operation?.kind === 'damage-targets' && multiTargetText ? operation : null
  const abilityHealTargets = operation?.kind === 'heal-targets' && multiTargetText ? operation : null
  const multiTargetAbility = abilityDamageTargets ?? abilityHealTargets
  const abilityMoveFront = operation?.kind === 'move-target-front'
  const abilityMoveSelf = operation?.kind === 'move-self' ? operation : null
  const abilitySwapSelf = operation?.kind === 'swap-self'
  if ((!operation && !abilityDraw && !abilityConveyor && !abilityLibrarian && !tauCannonAbility) || operation && !abilityHeal && !abilityDamage && !abilityPutTargetOnDeck && !abilityLockMovement && !abilityLucioHealth && !abilityDrawOrLimit && !abilitySacrificeBuilding && !abilityGamba && !multiTargetAbility && !abilityMoveFront && !abilityMoveSelf && !abilitySwapSelf && !abilitySelfDestruct && !['adjust-next-score', 'gain-black-token', 'gain-player-mana', 'gain-self-shield', 'next-attack-splash'].includes(operation.kind)) invalidCommand('UNSUPPORTED_EFFECT')
  if (operation?.kind === 'adjust-next-score' ? data.scoreAdjustment !== -1 && data.scoreAdjustment !== 1 : data.scoreAdjustment !== undefined) invalidCommand('INVALID_COMMAND')
  if (abilitySelfDestruct || abilityGamba) {
    const probe = structuredClone(match)
    applyTriggeredDamage(probe, probe.board.find(candidate => candidate.id === unit.id)!, 0, undefined, true)
  }
  const moveCells = abilityMoveSelf ? Array.from({ length: 25 }, (_, cell) => ({ row: Math.floor(cell / 5), col: cell % 5 })).filter(cell => !match.board.some(target => target.row === cell.row && target.col === cell.col)) : []
  if ((abilityMoveSelf || abilitySwapSelf) && movementIsBlocked(match.movementLock ?? null, match.current)) invalidCommand('MOVEMENT_BLOCKED')
  if (abilityMoveSelf && !moveCells.length) invalidCommand('INVALID_TARGET')
  const choiceTargets = match.board.filter(target => {
    if (target.dying) return false
    if (abilityDamage) return target.id !== unit.id && (target.card.Type === 0 || target.card.Type === 3) && (unit.card.Name !== 'Герсон Бум' || target.owner !== actorSeat) && canResolveTriggeredEffect(match, target, abilityDamage.amount, unit)
    if (abilitySacrificeBuilding) return target.owner === actorSeat && target.card.Type === 3 && !target.flippedTurns && canResolveTriggeredEffect(match, target, 0, unit, true)
    if (abilityPutTargetOnDeck) return target.card.Type === 0
    if (multiTargetAbility) return (target.card.Type === 0 || target.card.Type === 3) && targetMatchesKind(target.card.Type, multiTargetAbility.targetType) && (abilityDamageTargets ? canResolveTriggeredEffect(match, target, abilityDamageTargets.amount, unit) : true)
    if (target.card.Type !== 0 || target.flippedTurns) return false
    if (abilityHeal) return true
    if (abilitySwapSelf) return target.id !== unit.id
    if (!abilityMoveFront) return false
    const destination = forwardMoveDestination(unit.owner, unit.row, unit.col, match.board.some(other => other.row === unit.row + (unit.owner === 0 ? -1 : 1) && other.col === unit.col))
    return Boolean(destination)
  })
  const abilityDamagePlayerTarget = Boolean(abilityDamage && abilityCanTargetPlayer(description, index, unit.row === (actorSeat === 0 ? 0 : 4), unit.card.Name))
  if ((abilityHeal || abilityPutTargetOnDeck || abilityMoveFront || abilitySwapSelf || abilitySacrificeBuilding) && !choiceTargets.length || multiTargetAbility && choiceTargets.length < multiTargetAbility.count || abilityDamage && !choiceTargets.length && !abilityDamagePlayerTarget) invalidCommand('INVALID_TARGET')
  const cost = abilityCostOnField(description, index, actorSeat, match.board)
  const resource = abilityCostResource(description, index)
  const librarianCosts = ([1, 2, 4] as const).filter(value => value <= match.players[actorSeat]!.mana && [...match.players[actorSeat]!.deck, ...match.players[actorSeat]!.discard].some(card => card.Rarity === (value === 1 ? 0 : value === 2 ? 1 : 2)))
  if (resource === 'mana' && match.players[actorSeat]!.mana < cost) invalidCommand('NOT_ENOUGH_MANA')
  if (resource === 'black-token' && (unit.blackTokens ?? 0) < cost) invalidCommand('NOT_ENOUGH_BLACK_TOKENS')
  if (abilityConveyor && match.players[actorSeat]!.hand.length < 3) invalidCommand('NOT_ENOUGH_CARDS')
  if (abilityLibrarian && !librarianCosts.length) invalidCommand('INVALID_TARGET')

  if (abilityDraw) {
    const state = structuredClone(match)
    const source = state.board.find(candidate => candidate.id === unit.id)!
    const player = state.players[actorSeat]!
    player.mana -= cost
    const card = player.deck.shift()
    if (card) player.hand.push(card)
    source.abilityUsed = true
    state.version++
    state.log.push(`«${source.card.Name}» берёт карту.`)
    return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }] }
  }
  if (tauCannonAbility) {
    const state = structuredClone(match)
    const source = state.board.find(candidate => candidate.id === unit.id)!
    source.attack++
    source.abilityUsed = true
    state.version++
    state.log.push('«Тау-пушка» даёт +1 к атаке.')
    return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }] }
  }

  if (abilityLibrarian) {
    const state = structuredClone(match)
    state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'ability-librarian', sourceUnitId: unit.id, unitIds: [], stage: 'cost', abilityIndex: index }
    state.version++
    state.log.push('«Библиотекарь» выбирает стоимость поиска карты.')
    return { state, events: [{ type: 'ability.used', unitId: unit.id, abilityIndex: index }] }
  }

  const state = structuredClone(match)
  const source = state.board.find(candidate => candidate.id === unit.id)!
  if (resource === 'mana') state.players[actorSeat]!.mana -= cost
  else source.blackTokens = (source.blackTokens ?? 0) - cost
  if (abilityConveyor) {
    source.abilityUsed = true
    state.pendingChoice = { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: 'ability-conveyor', sourceUnitId: source.id, unitIds: state.players[actorSeat]!.hand.map(card => card.instanceId!).filter(Boolean), stage: 'discard' }
    state.version++
    state.log.push('«Конвейерное производство» начинает обработку карт из руки.')
    return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }] }
  }
  if (abilityGamba) {
    const player = state.players[actorSeat]!
    const roll = adjustGambaRoll(Math.floor(random() * 6) + 1, gambaModifierForUnit(source) + (player.nextGambaBonus ?? 0))
    player.nextGambaBonus = 0
    source.abilityUsed = !isRepeatableAbility(description, index)
    if (roll <= abilityGamba.maximumRoll) applyTriggeredDamage(state, source, 0, undefined, true)
    else player.mana += abilityGamba.mana
    state.version++
    state.log.push(`«${source.card.Name}»: гамба ${roll}${roll <= abilityGamba.maximumRoll ? ' — погибает.' : ` — +${abilityGamba.mana} маны.`}`)
    return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }, { type: 'ability.gamba.resolved', unitId: source.id, roll, died: roll <= abilityGamba.maximumRoll }] }
  }
  if (abilitySelfDestruct) {
    applyTriggeredDamage(state, source, 0, undefined, true)
    state.version++
    state.log.push(`«${source.card.Name}» погибает от своей способности.`)
    return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }] }
  }
  if (abilityDrawOrLimit) {
    source.abilityUsed = !isRepeatableAbility(description, index)
    state.pendingChoice = { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: 'ability-draw-or-limit', sourceUnitId: source.id, unitIds: [] }
    state.version++
    state.log.push('«Айсберг» выбирает эффект способности.')
    return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }] }
  }
  if (abilitySacrificeBuilding) {
    source.abilityUsed = !isRepeatableAbility(description, index)
    state.pendingChoice = { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: 'ability-sacrifice-building', sourceUnitId: source.id, unitIds: choiceTargets.map(target => target.id), amount: abilitySacrificeBuilding.amount, abilityIndex: index }
    state.version++
    state.log.push(`«${source.card.Name}» выбирает своё здание для уничтожения.`)
    return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }] }
  }
  if (abilityHeal || abilityDamage || abilityPutTargetOnDeck || multiTargetAbility || abilityMoveFront || abilityMoveSelf || abilitySwapSelf) {
    source.abilityUsed = !isRepeatableAbility(description, index)
    state.pendingChoice = abilityHeal
      ? { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: 'ability-heal-creature', sourceUnitId: source.id, unitIds: choiceTargets.map(target => target.id), abilityIndex: index, amount: abilityHeal.amount, shield: Boolean(abilityHeal.shield) }
      : abilityDamage
        ? { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: 'ability-damage-target', sourceUnitId: source.id, unitIds: choiceTargets.map(target => target.id), abilityIndex: index, amount: abilityDamage.amount, playerTarget: abilityDamagePlayerTarget }
        : abilityPutTargetOnDeck
          ? { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: 'ability-put-target-on-deck', sourceUnitId: source.id, unitIds: choiceTargets.map(target => target.id), abilityIndex: index }
      : multiTargetAbility
        ? { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: abilityDamageTargets ? 'ability-damage-targets' : 'ability-heal-targets', sourceUnitId: source.id, unitIds: choiceTargets.map(target => target.id), abilityIndex: index, amount: multiTargetAbility.amount, count: multiTargetAbility.count, ...(multiTargetAbility.targetType ? { targetType: multiTargetAbility.targetType } : {}) }
        : abilityMoveSelf
          ? { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: 'ability-move-self', sourceUnitId: source.id, unitIds: [], cells: moveCells, abilityIndex: index, ...(abilityMoveSelf.stunAdjacent ? { stunAdjacent: abilityMoveSelf.stunAdjacent } : {}) }
          : { id: `choice_${source.id}_${state.version + 1}`, owner: actorSeat, kind: abilitySwapSelf ? 'ability-swap-self' : 'ability-move-front', sourceUnitId: source.id, unitIds: choiceTargets.map(target => target.id), abilityIndex: index }
    state.version++
    state.log.push(`«${source.card.Name}» выбирает цель для способности.`)
    return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }] }
  }
  if (!operation) invalidCommand('UNSUPPORTED_EFFECT')
  switch (operation.kind) {
    case 'buff-allied-health':
      if (!abilityLucioHealth) invalidCommand('UNSUPPORTED_EFFECT')
      for (const ally of state.board.filter(candidate => candidate.owner === actorSeat && candidate.card.Type === 0 && !candidate.dying)) {
        Object.assign(ally, applyTemporaryHealthBuff({ ...ally, temporaryHealth: ally.temporaryHealth ?? 0 }, operation.amount))
        ally.temporaryHealthExpiresAt = (state.round - 1) * 2 + actorSeat + 1
      }
      break
    case 'gain-black-token': source.blackTokens = (source.blackTokens ?? 0) + operation.amount; break
    case 'gain-player-mana': state.players[actorSeat]!.mana += operation.amount; break
    case 'gain-self-shield': source.shield = true; break
    case 'adjust-next-score': state.players[actorSeat]!.nextScoreAdjustment = data.scoreAdjustment as -1 | 1; break
    case 'next-attack-splash': source.nextAttackSplashDamage = operation.amount; break
    case 'lock-movement-next-turn': state.movementLock = 1 - actorSeat; break
  }
  source.abilityUsed = !isRepeatableAbility(description, index)
  state.version++
  state.log.push(`«${source.card.Name}» использует способность.`)
  return { state, events: [{ type: 'ability.used', unitId: source.id, abilityIndex: index }] }
}

function playCard(match: MatchState, actorSeat: number, data: Record<string, unknown>, random: () => number, allowOffHomeRow = false) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  if (Object.keys(data).some(key => !['cardInstanceId', 'target', 'payment', 'horny'].includes(key)) || !['cardInstanceId', 'target', 'payment'].every(key => Object.hasOwn(data, key)) || typeof data.cardInstanceId !== 'string' || !data.cardInstanceId || !data.target || typeof data.target !== 'object' || Array.isArray(data.target) || data.payment !== 'mana' && data.payment !== 'health' || Object.hasOwn(data, 'horny') && typeof data.horny !== 'boolean') invalidCommand('INVALID_COMMAND')
  const target = data.target as Record<string, unknown>
  if (Object.keys(target).length !== 2 || !Number.isInteger(target.row) || !Number.isInteger(target.col) || Number(target.row) < 0 || Number(target.row) > 4 || Number(target.col) < 0 || Number(target.col) > 4) invalidCommand('INVALID_COMMAND')
  const player = match.players[actorSeat]!
  const handIndex = player.hand.findIndex(card => card.instanceId === data.cardInstanceId)
  if (handIndex < 0) invalidCommand('CARD_NOT_IN_HAND')
  const card = player.hand[handIndex]!
  const freePlay = Boolean(card.instanceId && player.freePlayCardIds?.includes(card.instanceId))
  if (card.Type !== 0 && card.Type !== 3) invalidCommand('UNSUPPORTED_CARD_TYPE')
  // shortcut: remaining named entry choices reject until their full server-side selection lifecycles are implemented.
  const wismuth = card.Name === 'Висмут Шифера'
  if (wismuth && (card.Type !== 0 || card.Description !== 'Вход: Возьмите предмет и здание из КД, сбросьте что-то одно, а второе оставьте.\nПосмертно: Повторяет эффект входа.')) invalidCommand('UNSUPPORTED_EFFECT')
  const yangusha = card.Name === 'Янгуша'
  if (yangusha && (card.Type !== 0 || card.Description !== 'Вход: Возьмите предмет.\r\nПосмертно: Отправляет свой предмет на верх КД.')) invalidCommand('UNSUPPORTED_EFFECT')
  const dextergon = card.Name === 'Декстергон'
  if (dextergon && (card.Type !== 0 || card.Description !== 'Щит\nХорни 6: Вход: Дайте существам слева и справа Щит')) invalidCommand('UNSUPPORTED_EFFECT')
  const v1Horny = card.Name === 'V1' && card.Type === 0 && card.Description?.replace(/\r\n/gu, '\n') === 'Досягаемость\nКоронный: Восстанавливает себе всё здоровье и восстанавливает здоровье владельца на величину равную своей атаке.\nНе работает на атаку с досягаемостью.\nПостоянно: Получает 1 за каждую убитую им карту\nХорни 10: Постоянно: Эффект коронный работает и на атаку с досягаемостью.'
  if (card.Name === 'V1' && !v1Horny) invalidCommand('UNSUPPORTED_EFFECT')
  if (data.horny === true && !dextergon && !v1Horny) invalidCommand('INVALID_COMMAND')
  const disappearingGuy = card.Name === 'Исчезающий парень'
  if (disappearingGuy && (card.Type !== 0 || card.Description !== 'Порыв\nВход: Гамба:\n1-4 - Сбрасываеться. \n5-6 - Ничего не происходит.')) invalidCommand('UNSUPPORTED_EFFECT')
  const viskas = card.Name === 'Вискас'
  if (viskas && (card.Type !== 0 || card.Description !== 'Вход: Возьмите или сбросьте карту.\nСчёт >5: Коронный: Возьмите или сбросьте карту')) invalidCommand('UNSUPPORTED_EFFECT')
  const indigolit = card.Name === 'Индиголит'
  if (indigolit && (card.Type !== 0 || card.Description !== 'Вход: Восстанавливает 1 здоровья 5 раз выбранным целям.')) invalidCommand('UNSUPPORTED_EFFECT')
  const hameleonew = card.Name === 'Hameleonew'
  if (hameleonew && (card.Type !== 0 || card.Description !== 'Вход: Следующая карта, которая должна сжечься, вместо этого сберегаеться')) invalidCommand('UNSUPPORTED_EFFECT')
  const birdli = card.Name === 'Бёрдли'
  if (birdli && (card.Type !== 0 || card.Description !== 'Вход: Ваша следующая гамба имеет +2.\nПосмертно: Бёрдли вместо сброса получает эффект Переворот 3, только по окончанию этого эффекта он сбрасывается')) invalidCommand('UNSUPPORTED_EFFECT')
  const wondertian = card.Name === 'Вондертян'
  if (wondertian && (card.Type !== 0 || card.Description !== 'Вход: берите карты пока их у вас не будет 8. Ваш лимит карт до конца следующего хода равен 8.')) invalidCommand('UNSUPPORTED_EFFECT')
  const depressiveJaw = card.Name === 'Депрессивная Жопа'
  if (depressiveJaw && (card.Type !== 3 || card.Description !== depressiveJawDescription)) invalidCommand('UNSUPPORTED_EFFECT')
  const row = Number(target.row), col = Number(target.col)
  if (card.Type === 0 ? row !== (actorSeat === 0 ? 4 : 0) && !allowOffHomeRow : row === 0 || row === 4) invalidCommand('INVALID_TARGET')
  const occupiedTarget = match.board.some(unit => unit.row === row && unit.col === col)
  const pushedLine = occupiedTarget && card.Type === 0 ? creaturePushLine(match.board, actorSeat, row, col, match.movementLock ?? null) : null
  if (occupiedTarget && !pushedLine) invalidCommand('INVALID_TARGET')
  const description = card.Description ?? ''
  const entryLine = description.match(/Вход\s*:\s*([^\r\n]*)/iu)?.[1]?.trim() ?? ''
  const yellowEntry = card.Name === 'Жёлтый' && card.Type === 0 && description === 'Вход: Умирает.'
  if (card.Name === 'Жёлтый' && !yellowEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const yellowDiamondEntry = card.Name === 'Жёлтый алмаз' && card.Type === 0 && description === 'Порыв\nВход: Накладывает Переворот 2 на все картам на поле кроме себя.\nПостоянно: Может атаковать перевёрнутые карты не получая урона в ответ.'
  if (card.Name === 'Жёлтый алмаз' && !yellowDiamondEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const turbotEntry = card.Name === 'Турбот' && card.Type === 0 && description === 'Вход: Отменяет эффект переворот у всех существ.'
  if (card.Name === 'Турбот' && !turbotEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const aibollEntry = card.Name === 'Айболл' && card.Type === 0 && description === 'Порыв\nВход: Уничтожает здание.'
  if (card.Name === 'Айболл' && !aibollEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const asiEntry = card.Name === 'Аси.mp4' && card.Type === 0 && description === 'Вход: Полностью восстанавливает здоровье выбранному существу и применяет на него Переворот 2.'
  if (card.Name === 'Аси.mp4' && !asiEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const normalizedDescription = description.replace(/\r\n/gu, '\n')
  const entryStunEntry = card.Type === 0 && (
    card.Name === 'Мендор' && normalizedDescription === 'Невидимость\nВход: Накладывает на ваше существо оглушение 2'
    || card.Name === 'Тюшма' && normalizedDescription === 'Вход: Накладывает на существо оглушение 2 есди вы сожгли карту в этом ходу.'
    || card.Name === 'Ральзей' && normalizedDescription === 'Вход: Восстанавливает вам 4 здоровья и накладывает оглушение 1 на выбранное вражеское существо.'
  )
  if (['Мендор', 'Тюшма', 'Ральзей'].includes(card.Name) && !entryStunEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const viskasEntry = viskas && entryLine === 'Возьмите или сбросьте карту.' && (player.deck.length > 0 || player.hand.length > 1)
  const entryEnabled = entryLine && entryEffectConditionMet(description, player.hand.length, player.nextScoreAdjustment)
  const yellowDiamondFlip = entryEnabled && yellowDiamondEntry ? entryFieldFlipTurns(description) : null
  const dummyBuilding = card.Name === 'Безумный манекен' && card.Type === 0 && description === 'Вход: Получает +2 ⚔️ и порыв если у вас есть здание.'
  if (card.Name === 'Безумный манекен' && !dummyBuilding) invalidCommand('UNSUPPORTED_EFFECT')
  const entryBuff = entryEnabled && dummyBuilding ? entryBuffForCard(card.Name, match.board.some(unit => unit.owner === actorSeat && unit.card.Type === 3 && !unit.dying)) : null
  const gnomeEntry = card.Name === 'Гном' && card.Type === 0 && description === 'Вход: Существо слева получает +2 ❤️, а справа +2⚔️'
  if (card.Name === 'Гном' && !gnomeEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const neighborBuffs = entryEnabled && gnomeEntry ? entryNeighborBuffs(description) : null
  const entryDebuff = entryEnabled && card.Type === 0 && (card.Name === 'Железная няня' && description === 'Порыв\nВход: Накладывает на всех вражеских существ -1⚔️' || card.Name === 'Бараш' && description === 'Вход: Положите -2⚔️ -2⚡на всех вражеских существ на поле.\nСжигается') ? entryDebuffForCard(card.Name) : null
  const entryDiscardWholeHand = Boolean(entryEnabled && entryDiscardsEntireHand(description))
  const entryResource = entryEnabled ? entryResourceGain(description) : null
  const roundStatBuff = entryEnabled ? entryRoundStatBuff(description) : null
  const entryOperation = entryEnabled ? entryTargetOperation(description) : null
  const bluzkEntry = entryEnabled && card.Type === 0 && card.Name === 'Блузк' && description === 'Вход: Сберегите вашего существо на поле.\nСчёт <1: Разыграйте верхнюю карту из КД'
  if (card.Name === 'Блузк' && !bluzkEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const bluzkDeckPlay = bluzkEntry ? entryScorePlayFromDeck(description) : null
  const gendaBossEntry = entryEnabled && card.Type === 0 && card.Name === 'ГендаБосс' && description === 'Вход: Получите 30 урона. Все ваши текущие и будущие существа имеют +2⚔️ +2❤️ +1.\nСжигается'
  if (card.Name === 'ГендаБосс' && !gendaBossEntry) invalidCommand('UNSUPPORTED_EFFECT')
  const entryMoveBuilding = entryOperation?.kind === 'move-building-one' ? entryOperation : null
  const entryMoveBuildingTargets = entryMoveBuilding ? match.board.filter(building => building.card.Type === 3 && !building.dying && !building.flippedTurns && ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dr, dc]) => building.row + dr > 0 && building.row + dr < 4 && building.col + dc >= 0 && building.col + dc < 5 && !match.board.some(unit => unit.row === building.row + dr && unit.col === building.col + dc))) : []
  const entryHeal = entryEnabled && entryOperation?.kind !== 'sacrifice-ally-heal-player' ? entryPlayerHealAmount(description) : null
  const entryDamage = entryEnabled ? entryOpponentDamage(description) : null
  const entryDraw = entryEnabled ? entryDrawCount(description) : null
  const entryHandSize = entryEnabled ? entryDrawToHandSize(description) : null
  const entryPile = entryEnabled ? entryPileDraw(description) : null
  const entrySavedPiles = entryEnabled ? entrySavePiles(description) : null
  const entryStunOperation = entryStunEntry && entryOperation?.kind === 'stun-target' ? entryOperation : null
  const entryStunEnabled = entryStunOperation && entryOperationConditionMet(entryStunOperation, player.burnedThisTurn)
  const salubraHeal = entryOperation?.kind === 'heal-allied-creatures-and-gain-energy' && card.Name === 'Салюбра' && card.Type === 0 && description === 'Вход: Восстанавливает 3 здоровья вашим существам, а вы получаете 1 энергию за каждое исцелённое' ? entryOperation : null
  if (card.Name === 'Салюбра' && !salubraHeal) invalidCommand('UNSUPPORTED_EFFECT')
  const entryDamageTarget = entryOperation?.kind === 'damage-target' ? entryOperation : null
  const entryDamageTargets = entryDamageTarget ? match.board.filter(candidate => [0, 3].includes(candidate.card.Type) && !candidate.dying) : []
  const entryGambaDamage = entryOperation?.kind === 'gamba-damage-each-creature' ? entryOperation : null
  const entryGambaTargets = entryGambaDamage ? match.board.filter(candidate => candidate.card.Type === 0 && !candidate.dying && !candidate.flippedTurns) : []
  const entryTypeToken = entryOperation?.kind === 'give-type-tokens-if-none' ? entryOperation : null
  const entryTypeTokenTargets = entryTypeToken ? match.board.filter(candidate => candidate.card.Type === 0 && !candidate.dying && !candidate.flippedTurns && !hasWhiteTypeTokens(candidate)) : []
  const entrySacrificeHeal = entryOperation?.kind === 'sacrifice-ally-heal-player' ? entryOperation : null
  const entrySaveAllied = entryOperation?.kind === 'save-allied-card' || bluzkEntry && entryOperation?.kind === 'save-target' ? entryOperation : null
  const entrySaveAlliedTargets = entrySaveAllied ? match.board.filter(candidate => candidate.owner === actorSeat && (bluzkEntry ? candidate.card.Type === 0 : [0, 3].includes(candidate.card.Type)) && !candidate.dying && !candidate.flippedTurns) : []
  const entryReturnCreature = entryOperation?.kind === 'return-creature-to-hand' ? entryOperation : null
  const entryTakeEnemyBuilding = entryOperation?.kind === 'take-enemy-building' ? entryOperation : null
  const entryTakeEnemyBuildingTargets = entryTakeEnemyBuilding ? match.board.filter(candidate => candidate.card.Type === 3 && candidate.owner !== actorSeat && !candidate.dying) : []
  let entryGambaRoll: number | null = null
  const entryHealAmount = entryOperation?.kind === 'heal-creature' ? entryOperation.amount : undefined
  const takeItemTargets = entryOperation?.kind === 'take-target-item' ? match.board.filter(candidate => candidate.card.Type === 0 && !candidate.dying && candidate.item) : []
  const aibollTargets = aibollEntry ? match.board.filter(candidate => candidate.card.Type === 3 && !candidate.dying) : []
  const healChoice = entryOperation?.kind === 'heal-creature' && (!entryOperation.flipTurns && (entryOperation.amount !== undefined || /^Полностью восстанавливает здоровье выбранному существу\.?$/iu.test(entryLine)) || asiEntry)
  const saveFlippedChoice = entryOperation?.kind === 'save-flipped' && /^Сберегите выбранную перев(?:ё|е)рнутую карту\.?$/iu.test(entryLine)
  const saveFlippedTargets = saveFlippedChoice ? match.board.filter(unit => unit.flippedTurns && !unit.dying) : []
  if (saveFlippedChoice && !saveFlippedTargets.length) invalidCommand('INVALID_TARGET')
  if (entryEnabled && !turbotEntry && !yellowDiamondEntry && !aibollEntry && !asiEntry && !entryStunEntry && !entryDamageTarget && !entryGambaDamage && !entryTypeToken && !gendaBossEntry && !entryMoveBuilding && !bluzkEntry && !entrySacrificeHeal && !entrySaveAllied && !entryReturnCreature && !entryTakeEnemyBuilding && !entrySavedPiles && (!wismuth && !disappearingGuy && !dextergon && !viskas && !indigolit && !salubraHeal && !yangusha && !yellowEntry && !entryDebuff && !dummyBuilding && !gnomeEntry && !(entryOperation?.kind === 'heal-creature' && entryOperation.amount !== undefined) && !entryBuff && !/^(?:Следующая карта, которая должна сжечься, вместо этого сберегаеться|Ваша следующая гамба имеет \+2|бер(?:и|ите) карты пока их у вас не будет 8\. Ваш лимит карт до конца следующего хода равен 8\.|Забирает предмет у выбранного существа|Возьмите\s+\d*\s*карт(?:у|ы)?|Возьм(?:и|ите)\s+(?:существо|предмет|заклинание|здание)\s+из\s+(?:КД|КС)|Возьмите\s+(?:самую нижнюю карту|\d+ нижние карты)\s+из\s+(?:КД|КС)|Сбросьте\s+(?:всю\s+)?свою\s+руку|Получите\s+\d+\s+(?:маны|энергии)|Восстанавливает\s+вам\s+\d+\s+здоровья|Наносит\s+\d+\s+урона\s+противнику(?:\s+если\s+у\s+вас\s+есть\s+минимум\s+\d+\s+сбереж[её]нных\s+существ(?:а)?\s+стоимостью\s+\d+\s+или\s+меньше)?|Полностью\s+восстанавливает\s+здоровье\s+выбранному\s+существу|Сберегите\s+выбранную\s+перев(?:ё|е)рнутую\s+карту|Получает\s+\+\d+\s*⚔️\s*и\s*\+\d+\s*❤️\s+если\s+у\s+вас\s+\d+\s+раунд)\.?$/iu.test(entryLine) || (description.match(/Вход\s*:/giu)?.length ?? 0) !== 1 || !entryResource && entryHeal === null && !entryDamage && !healChoice && !saveFlippedChoice && !(entryOperation?.kind === 'take-target-item') && !salubraHeal && !entryDamageTarget && !entryGambaDamage && !entryTypeToken && !gendaBossEntry && !entryMoveBuilding && !bluzkEntry && !entrySacrificeHeal && !entrySaveAllied && !entryReturnCreature && !entryTakeEnemyBuilding && !entrySavedPiles && !entryDiscardWholeHand && !roundStatBuff && entryDraw === null && !entryPile && !hameleonew && !birdli && entryHandSize === null && !wondertian && !viskasEntry && !indigolit && !disappearingGuy && !dextergon && !wismuth && !yangusha && !yellowEntry && !entryDebuff && !dummyBuilding && !gnomeEntry || entryScoreConditionMet(description, player.hand.length, player.nextScoreAdjustment))) invalidCommand('UNSUPPORTED_EFFECT')
  const paradiseSources = card.Type === 0 ? match.board.filter(unit => unit.owner !== actorSeat && unit.card.Name === 'Внешний рай' && !unit.dying && !unit.flippedTurns && match.board.some(target => target.owner === unit.owner && target.card.Type === 0 && !target.dying)).map(unit => {
    if (unit.card.Description !== 'Постоянно: Каждый раз когда противник разыгрывает существо, даёт выбранному существу 1.') invalidCommand('UNSUPPORTED_EFFECT')
    return { id: unit.id, owner: unit.owner }
  }) : []

  let cost = Number(card.Cost ?? 0)
  for (const source of match.board.filter(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Мкия')) cost = scoreDiscountedCost(cost, source.card.Description ?? '', player.hand.length, 2)
  const bloodEmpireActive = match.board.some(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Империя крови')
  if (!freePlay && data.payment === 'health' && !canUseHealthPayment(card.Type, bloodEmpireActive)) invalidCommand('PAYMENT_NOT_ALLOWED')

  const state = structuredClone(match)
  const actingPlayer = state.players[actorSeat]!
  if (pushedLine) for (const original of [...pushedLine].reverse()) {
    const pushed = state.board.find(unit => unit.id === original.id)!
    const from = { row: pushed.row, col: pushed.col }
    pushed.row += actorSeat === 0 ? -1 : 1
    applyMovementTriggers(state, pushed, from, undefined, false)
  }
  if (!freePlay && !payCardCost(actingPlayer, cost, data.payment as 'mana' | 'health')) invalidCommand(data.payment === 'health' ? 'NOT_ENOUGH_HEALTH' : 'NOT_ENOUGH_MANA')
  if (freePlay) actingPlayer.freePlayCardIds = actingPlayer.freePlayCardIds!.filter(id => id !== card.instanceId)
  const [playedCard] = actingPlayer.hand.splice(handIndex, 1)
  const playedDescription = playedCard!.Description ?? ''
  const scoreAdjustment = consumeNextScoreAdjustment(actingPlayer, playedDescription)
  const bluzkScorePlay = Boolean(bluzkDeckPlay && entryScoreConditionMet(description, player.hand.length, scoreAdjustment))
  const gendaBossBuff = card.Type === 0 ? actingPlayer.gendaBossStacks ?? 0 : 0
  const unit: BoardUnit = {
    id: `unit_${match.version + 1}`,
    card: playedCard!,
    owner: actorSeat,
    row,
    col,
    health: Math.max(1, Number(playedCard!.Health ?? 1)) + 2 * gendaBossBuff,
    maxHealth: Math.max(1, Number(playedCard!.Health ?? 1)) + 2 * gendaBossBuff,
    attack: Number(playedCard!.Attack ?? 0) + 2 * gendaBossBuff,
    speed: Number(playedCard!.Speed ?? 0) - gendaBossBuff,
    shield: itemGrantsShield(description),
    flippedTurns: initialFlipTurns(description),
    summoned: entryBuff ? match.round - 1 : match.round,
    attacks: 0,
    abilityUsed: false,
    stunned: 0,
    blackTokens: 0,
    dying: false,
    ...(v1Horny && data.horny === true ? { v1RangedCrown: true } : {}),
  }
  state.board.push(unit)
  applyCardPlayFieldEffects(state, actorSeat, card.Type)
  if (entryEnabled && turbotEntry) for (const target of [...state.board].filter(candidate => candidate.card.Type === 0 && candidate.flippedTurns && !candidate.dying)) {
    target.flippedTurns = 0
    if (target.health <= 0) applyTriggeredDamage(state, target, 0, undefined, true, false, 0, false, random)
  }
  if (yellowDiamondFlip !== null) for (const target of state.board.filter(candidate => candidate.id !== unit.id && !candidate.dying)) {
    target.flippedTurns = yellowDiamondFlip
    const trigger = resolveFlipTrigger(target.card.Name, target)
    Object.assign(target, trigger.state)
    const owner = state.players[target.owner]!
    for (let index = 0; index < trigger.draw && owner.deck.length; index++) owner.hand.push(owner.deck.shift()!)
    owner.mana += trigger.mana
  }
  if (entryBuff) unit.attack += entryBuff.attack
  if (neighborBuffs) for (const [side, buff] of Object.entries(neighborBuffs)) {
    const neighbor = state.board.find(candidate => candidate.row === row && candidate.col === col + (side === 'left' ? -1 : 1) && candidate.card.Type === 0 && !candidate.dying)
    if (neighbor) Object.assign(neighbor, applyEntryNeighborBuff(neighbor, buff))
  }
  if (entryDebuff) for (const enemy of state.board.filter(candidate => candidate.owner !== actorSeat && candidate.card.Type === 0 && !candidate.dying)) Object.assign(enemy, applyCombatStatChanges(enemy, entryDebuff.attack, entryDebuff.speed))
  if (v1Horny && data.horny === true) {
    actingPlayer.health = Math.max(0, actingPlayer.health - 10)
    if (!actingPlayer.health) {
      state.status = 'finished'
      state.winnerUserId = state.players[winnerWhenPlayerFalls(actorSeat as 0 | 1)]!.userId
      state.endReason = 'entry'
    }
  }
  if (dextergon && data.horny === true) {
    actingPlayer.health = Math.max(0, actingPlayer.health - 6)
    if (!actingPlayer.health) {
      state.status = 'finished'
      state.winnerUserId = state.players[winnerWhenPlayerFalls(actorSeat as 0 | 1)]!.userId
      state.endReason = 'entry'
    }
    for (const target of state.board.filter(candidate => candidate.id !== unit.id && candidate.card.Type === 0 && !candidate.dying && !candidate.flippedTurns && candidate.row === row && Math.abs(candidate.col - col) === 1)) target.shield = true
  }
  if (roundStatBuff && state.round >= roundStatBuff.minimumRound) {
    unit.attack += roundStatBuff.attack
    unit.health += roundStatBuff.health
    unit.maxHealth += roundStatBuff.health
  }
  const healTargets = healChoice ? match.board.filter(candidate => (candidate.card.Type === 0 || entryHealAmount !== undefined && candidate.card.Type === 3) && !candidate.dying && !candidate.flippedTurns) : []
  if (entryEnabled) {
    if (bluzkScorePlay && !entrySaveAlliedTargets.length) grantFreeTopDeckCard(state, actorSeat, playedCard!.Name)
    if (gendaBossEntry) {
      actingPlayer.gendaBossStacks = gendaBossBuff + 1
      for (const ally of state.board.filter(candidate => candidate.owner === actorSeat && candidate.card.Type === 0 && !candidate.dying)) {
        ally.attack += 2
        ally.health += 2
        ally.maxHealth += 2
        ally.speed -= 1
      }
      actingPlayer.health = Math.max(0, actingPlayer.health - 30)
      state.log.push('«ГендаБосс»: владелец получает 30 урона, существа владельца получают +2 к атаке, +2 к здоровью и +1 к скорости.')
      if (actingPlayer.health === 0) {
        state.status = 'finished'
        state.winnerUserId = state.players[winnerWhenPlayerFalls(actorSeat as 0 | 1)]!.userId
        state.endReason = 'entry'
      }
    }
    if (entryGambaDamage) {
      entryGambaRoll = adjustGambaRoll(Math.floor(random() * 6) + 1, actingPlayer.nextGambaBonus ?? 0)
      actingPlayer.nextGambaBonus = 0
      if (entryGambaRoll > entryGambaDamage.maximumRoll) state.log.push(`«${playedCard!.Name}»: гамба ${entryGambaRoll} — без эффекта.`)
    }
    if (hameleonew) actingPlayer.nextBurnToSave = (actingPlayer.nextBurnToSave ?? 0) + 1
    if (birdli) actingPlayer.nextGambaBonus = (actingPlayer.nextGambaBonus ?? 0) + 2
    if (entryHandSize !== null) {
      while (actingPlayer.hand.length < entryHandSize && actingPlayer.deck.length) actingPlayer.hand.push(actingPlayer.deck.shift()!)
      setTemporaryHandLimit(actingPlayer, entryHandSize, (state.round - 1) * 2 + actorSeat + 2)
    }
    if (entryDraw !== null) for (let index = 0; index < entryDraw && actingPlayer.deck.length; index++) actingPlayer.hand.push(actingPlayer.deck.shift()!)
    if (entrySavedPiles) for (const pile of entrySavedPiles) {
      const saved = takePileCard(actingPlayer[pile], pile, 'top')
      if (saved) actingPlayer.saved.push(saved)
    }
    if (entryPile) for (let index = 0; index < entryPile.count; index++) {
      const drawn = takePileCard(actingPlayer[entryPile.source], entryPile.source, entryPile.from, entryPile.cardType)
      if (drawn) actingPlayer.hand.push(drawn)
    }
    if (entryResource) actingPlayer[entryResource.resource] += entryResource.amount
    if (entryHeal !== null) actingPlayer.health = Math.min(45, actingPlayer.health + entryHeal)
    if (salubraHeal) {
      const targets = state.board.filter(candidate => candidate.owner === actorSeat && candidate.card.Type === 0 && !candidate.dying && !candidate.flippedTurns && candidate.health < candidate.maxHealth)
      for (const target of targets) {
        const before = target.health
        target.health = Math.min(target.maxHealth, target.health + salubraHeal.heal)
        if (state.board.some(source => source.owner === actorSeat && !source.dying && !source.flippedTurns && source.card.Name === 'Розовый Алмаз')) target.shield = true
        const reward = ameHealingReward(state.board, actorSeat, before, target.maxHealth, target.health - before)
        if (reward) state.board.filter(source => source.owner === actorSeat && !source.dying && !source.flippedTurns && source.card.Name === 'Аме').forEach(source => { source.attack += reward })
      }
      actingPlayer.energy += targets.length * salubraHeal.energy
    }
    if (entryDamage) {
      const savedCreatures = actingPlayer.saved.filter(saved => saved.Type === 0 && (saved.Cost ?? 0) <= (entryDamage.maximumSavedCreatureCost ?? Infinity))
      if (entryDamage.minimumSavedCreatures === undefined || savedCreatures.length >= entryDamage.minimumSavedCreatures) {
        const opponentSeat = 1 - actorSeat
        const opponent = state.players[opponentSeat]!
        opponent.health = Math.max(0, opponent.health - entryDamage.amount)
        if (opponent.health === 0) {
          state.status = 'finished'
          state.winnerUserId = state.players[winnerWhenPlayerFalls(opponentSeat as 0 | 1)]!.userId
          state.endReason = 'entry'
        }
      }
    }
    if (entryDiscardWholeHand) {
      actingPlayer.discard.push(...actingPlayer.hand.splice(0))
      if (depressiveJaw) enterDepressiveHandLimit(actingPlayer)
    }
    const tokenGain = entryTokenGain(playedDescription, player.hand.length, scoreAdjustment)
    if (viskasEntry) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'viskas-choice', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: [], stage: 'option' }
    else if (entryEnabled && aibollTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-destroy-building', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: aibollTargets.map(candidate => candidate.id) }
    else if (entrySacrificeHeal) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-sacrifice-ally-heal', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: state.board.filter(candidate => candidate.owner === actorSeat && candidate.card.Type === 0 && !candidate.dying && !candidate.flippedTurns).map(candidate => candidate.id), amount: entrySacrificeHeal.amount }
    else if (entryGambaDamage && entryGambaRoll !== null && entryGambaRoll <= entryGambaDamage.maximumRoll && entryGambaTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-damage-target', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: entryGambaTargets.filter(candidate => candidate.id !== unit.id).map(candidate => candidate.id), amount: countCreaturesOnField(state.board.map(candidate => ({ type: candidate.card.Type, dying: candidate.dying }))), roll: entryGambaRoll }
    else if (entryGambaDamage && entryGambaRoll !== null && entryGambaRoll <= entryGambaDamage.maximumRoll) state.log.push(`«${playedCard!.Name}»: гамба ${entryGambaRoll} — нет доступной цели.`)
    else if (entryTypeToken && entryTypeTokenTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-type-token', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: entryTypeTokenTargets.map(candidate => candidate.id), stage: 'target', remaining: entryTypeToken.count }
    else if (entryMoveBuilding && entryMoveBuildingTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-move-building', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: entryMoveBuildingTargets.map(candidate => candidate.id) }
    else if (entryDamageTarget && entryDamageTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-damage-target', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: state.board.filter(candidate => candidate.id !== unit.id && [0, 3].includes(candidate.card.Type) && !candidate.dying).map(candidate => candidate.id), amount: entryDamageTarget.amount }
    else if (entryStunEnabled) {
      const targets = state.board.filter(candidate => candidate.card.Type === 0 && !candidate.dying && !candidate.flippedTurns && (entryStunOperation!.targetOwner === undefined || entryStunOperation!.targetOwner === 'any' || entryStunOperation!.targetOwner === 'ally' && candidate.owner === actorSeat || entryStunOperation!.targetOwner === 'enemy' && candidate.owner !== actorSeat))
      if (targets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-stun-creature', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: targets.map(candidate => candidate.id), turns: entryStunOperation!.turns }
    }
    else if (entryTakeEnemyBuilding && entryTakeEnemyBuildingTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-take-enemy-building', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: entryTakeEnemyBuildingTargets.map(candidate => candidate.id) }
    else if (entryReturnCreature) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-return-creature', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: state.board.filter(candidate => candidate.card.Type === 0 && !candidate.dying && !candidate.flippedTurns).map(candidate => candidate.id) }
    else if (entrySaveAllied && entrySaveAlliedTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-save-allied', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: entrySaveAlliedTargets.map(candidate => candidate.id), ...(bluzkScorePlay ? { playDeckTop: true } : {}) }
    else if (saveFlippedChoice) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-save-flipped', sourceUnitId: unit.id, unitIds: saveFlippedTargets.map(candidate => candidate.id), sourceCardName: playedCard!.Name }
    else if (takeItemTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'entry-take-item', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: takeItemTargets.map(candidate => candidate.id) }
    else if (healTargets.length) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}`, owner: actorSeat, kind: 'heal-creature', sourceUnitId: unit.id, unitIds: healTargets.map(candidate => candidate.id), entryTokens: tokenGain, ...(entryHealAmount !== undefined ? { amount: entryHealAmount } : {}), ...(entryOperation?.kind === 'heal-creature' && entryOperation.flipTurns ? { flipTurns: entryOperation.flipTurns } : {}) }
    else if (!healChoice && tokenGain) grantEntryEffectTokens(state.board.filter(candidate => !candidate.dying), actorSeat, tokenGain)
  }
  if (wismuth) resolveWismuthSearch(state, actorSeat, unit.id, playedCard!.Name, random)
  if (disappearingGuy) {
    const roll = adjustGambaRoll(Math.floor(random() * 6) + 1, gambaModifierForUnit(unit) + (actingPlayer.nextGambaBonus ?? 0))
    actingPlayer.nextGambaBonus = 0
    if (roll <= 4) applyTriggeredDamage(state, unit, 0, undefined, true)
    state.log.push(`«Исчезающий парень»: гамба ${roll}.`)
  }  if (indigolit) state.pendingChoice = { id: `choice_${unit.id}_${state.version + 1}_heal`, owner: actorSeat, kind: 'indigolit-heal', sourceUnitId: unit.id, sourceCardName: playedCard!.Name, unitIds: state.board.filter(candidate => [0, 3].includes(candidate.card.Type) && !candidate.dying && !candidate.flippedTurns).map(candidate => candidate.id), remaining: 5 }
  if (yellowEntry && entryEnabled) {
    applyTriggeredDamage(state, unit, 0, undefined, true, false, 0, false, random)
  }
  if (state.status === 'active') queueParadiseTargets(state, paradiseSources)
  actingPlayer.played = true
  state.version++
  state.log.push(`${actingPlayer.name} разыгрывает «${playedCard!.Name}».`)
  return { state, events: [{ type: 'card.played', cardId: playedCard!.Id, unitId: unit.id, target: { row, col } }] }
}

function resolveChoice(match: MatchState, actorSeat: number, data: Record<string, unknown>, random: () => number) {
  const choice = match.pendingChoice
  if (!choice || data.choiceId !== choice.id) invalidCommand('CHOICE_NOT_FOUND')
  if (choice.owner !== actorSeat) invalidCommand('NOT_CHOICE_OWNER')
  const selection = data.selection as Record<string, unknown> | undefined
  if (choice.kind === 'death-burn-flipped') {
    const targetId = selection?.unitId
    const target = typeof targetId === 'string' && choice.unitIds.includes(targetId) ? match.board.find(unit => unit.id === targetId && unit.flippedTurns && !unit.dying) : undefined
    if (Object.keys(data).length !== 2 || !selection || Object.keys(selection).length !== 1 || !target) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    state.pendingChoice = null
    const selected = state.board.find(unit => unit.id === target.id)!
    applyTriggeredDamage(state, selected, 0, undefined, true, true, 0, false, random)
    state.version++
    state.log.push(`«${choice.sourceCardName}» сжигает перевёрнутую карту.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, targetUnitId: selected.id }] }
  }
  if (choice.kind === 'death-weaken-target') {
    const targetId = selection?.unitId
    const target = typeof targetId === 'string' && choice.unitIds.includes(targetId) ? match.board.find(unit => unit.id === targetId && !unit.dying) : undefined
    const playerSelected = selection?.player === 'opponent' && choice.playerTarget
    if (Object.keys(data).length !== 2 || !selection || Object.keys(selection).length !== 1 || !target && !playerSelected) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    state.pendingChoice = null
    if (playerSelected) {
      const opponent = state.players[1 - actorSeat]!
      opponent.health = Math.max(0, opponent.health - 1)
      if (!opponent.health) { state.status = 'finished'; state.winnerUserId = state.players[actorSeat]!.userId; state.endReason = 'effect' }
      state.version++
      state.log.push(`«${choice.sourceCardName}» наносит противнику 1 урон.`)
      return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, playerTarget: true }] }
    }
    const selected = state.board.find(unit => unit.id === target!.id)!
    applyTriggeredDamage(state, selected, 1, undefined, false, false, 0, false, random)
    Object.assign(selected, applyCombatStatChanges(selected, -1, 0))
    state.version++
    state.log.push(`«${choice.sourceCardName}» наносит выбранной цели 1 урон и уменьшает её атаку на 1.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, targetUnitId: selected.id }] }
  }
  if (choice.kind === 'death-save-deck-cards') {
    const ids = selection?.unitIds
    const owner = match.players[actorSeat]!
    const indexes = Array.isArray(ids) && ids.every(id => typeof id === 'string' && choice.unitIds.includes(id)) ? ids.map(id => owner.deck.findIndex(card => card.instanceId === id)) : []
    const totalCost = indexes.reduce((sum, index) => sum + Number(owner.deck[index]?.Cost ?? 0), 0)
    if (Object.keys(data).length !== 2 || !selection || Object.keys(selection).length !== 1 || !Array.isArray(ids) || ids.length > choice.count || new Set(ids).size !== ids.length || indexes.length !== ids.length || indexes.some(index => index < 0) || totalCost > choice.totalCost) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const player = state.players[actorSeat]!
    for (const index of indexes.sort((a, b) => b - a)) player.saved.push(player.deck.splice(index, 1)[0]!)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» сберегает выбранные карты из колоды.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, count: ids.length }] }
  }
  if (choice.kind === 'death-intivi') {
    if (Object.keys(data).length !== 2 || !selection || Object.keys(selection).length !== 1 || !['keep', 'discard'].includes(String(selection.choice))) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const owner = state.players[actorSeat]!
    const index = owner.hand.findIndex(card => card.instanceId === choice.itemInstanceId && card.Type === 1)
    if (index < 0) invalidCommand('INVALID_CHOICE')
    if (selection.choice === 'discard') owner.discard.push(owner.hand.splice(index, 1)[0]!)
    state.pendingChoice = null
    state.version++
    state.log.push(selection.choice === 'discard' ? `«ИНТИВИ» сбрасывает «${choice.itemName}».` : `«ИНТИВИ» оставляет «${choice.itemName}» в руке.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, choice: selection.choice }] }
  }
  if (choice.kind === 'crown-play-saved-spell') {
    const cardInstanceId = selection?.unitId
    const savedIndex = typeof cardInstanceId === 'string' && choice.unitIds.includes(cardInstanceId) ? match.players[actorSeat]!.saved.findIndex(card => card.instanceId === cardInstanceId && card.Type === 2) : -1
    if (Object.keys(data).length !== 2 || !selection || Object.keys(selection).length !== 1 || savedIndex < 0) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const owner = state.players[actorSeat]!
    const [card] = owner.saved.splice(savedIndex, 1)
    owner.hand.push(card!)
    ;(owner.freePlayCardIds ??= []).push(card!.instanceId!)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» позволяет бесплатно разыграть заклинание «${card!.Name}» из сбережений.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: card!.instanceId }] }
  }
  if (choice.kind === 'start-turn-sent-croix') {
    if (Object.keys(data).length !== 2 || !selection || !match.pendingTurnStart) invalidCommand('INVALID_CHOICE')
    const source = match.board.find(unit => unit.id === choice.sourceUnitId && unit.owner === actorSeat && !unit.dying && !unit.flippedTurns)
    const player = match.players[actorSeat]!
    if (!source) invalidCommand('INVALID_CHOICE')
    if (choice.stage === 'card') {
      const cardInstanceId = selection.unitId
      const cardIndex = typeof cardInstanceId === 'string' && choice.unitIds.includes(cardInstanceId) ? player.hand.findIndex(card => card.instanceId === cardInstanceId && card.Type === 0) : -1
      if (Object.keys(selection).length !== 1 || cardIndex < 0 || !cheapestCreatureIndexes(player.hand).includes(cardIndex)) invalidCommand('INVALID_CHOICE')
      const cells = freeAdjacentSockets(source.row, source.col, match.board)
      if (!cells.length) invalidCommand('INVALID_CHOICE')
      const state = structuredClone(match)
      state.pendingChoice = { ...choice, id: `${choice.id}_cell`, stage: 'cell', cardInstanceId: cardInstanceId as string, unitIds: [], cells }
      state.version++
      return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, stage: 'card' }] }
    }
    const selectedCell = selection.cell as Record<string, unknown> | undefined
    const cardIndex = player.hand.findIndex(card => card.instanceId === choice.cardInstanceId && card.Type === 0)
    if (Object.keys(selection).length !== 1 || !selectedCell || Array.isArray(selectedCell) || Object.keys(selectedCell).length !== 2 || !Number.isInteger(selectedCell.row) || !Number.isInteger(selectedCell.col) || cardIndex < 0 || !cheapestCreatureIndexes(player.hand).includes(cardIndex)) invalidCommand('INVALID_CHOICE')
    const cells = freeAdjacentSockets(source.row, source.col, match.board)
    if (!cells.some(cell => cell.row === selectedCell!.row && cell.col === selectedCell!.col)) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    state.pendingChoice = null
    ;(state.players[actorSeat]!.freePlayCardIds ??= []).push(choice.cardInstanceId!)
    const played = playCard(state, actorSeat, { cardInstanceId: choice.cardInstanceId!, target: { row: Number(selectedCell.row), col: Number(selectedCell.col) }, payment: 'mana' }, random, true)
    return { state: played.state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, stage: 'cell' }, ...played.events] }
  }
  if (choice.kind === 'entry-type-token' && choice.stage === 'token') {
    const tokenClass = selection?.tokenClass
    if (Object.keys(data).length !== 2 || !selection || Object.keys(selection).length !== 1 || !Number.isInteger(tokenClass) || Number(tokenClass) < 0 || Number(tokenClass) > 5) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const target = state.board.find(unit => unit.id === choice.targetUnitId && unit.card.Type === 0 && !unit.dying && !unit.flippedTurns)
    if (!target) invalidCommand('INVALID_CHOICE')
    target.typeTokens = addTypeToken(target.typeTokens ?? [0, 0, 0, 0, 0, 0], Number(tokenClass))
    state.version++
    if (choice.remaining === 1) {
      state.pendingChoice = null
      state.log.push(`«${choice.sourceCardName}» даёт «${target.card.Name}» три белых жетона типажа.`)
    } else state.pendingChoice = { ...choice, id: `${choice.id}_token_${choice.remaining - 1}`, remaining: choice.remaining - 1 }
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, tokenClass }] }
  }
  const multi = choice.kind === 'ability-damage-targets' || choice.kind === 'ability-heal-targets' || choice.kind === 'spell-swap-creatures' || choice.kind === 'spell-swap-stats' || choice.kind === 'spell-destroy-creatures'
  if (Object.keys(data).length !== 2 || !selection) invalidCommand('INVALID_COMMAND')
  if (choice.kind === 'paradise-target') {
    if (Object.keys(selection).length !== 1 || typeof selection.unitId !== 'string' || !choice.unitIds.includes(selection.unitId)) invalidCommand('INVALID_CHOICE')
    const target = match.board.find(unit => unit.id === selection.unitId && unit.owner === choice.owner && unit.card.Type === 0 && !unit.dying)
    if (!target) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const selected = state.board.find(unit => unit.id === target.id)!
    selected.energyCostReduction = (selected.energyCostReduction ?? 0) + 1
    state.pendingChoice = null
    state.version++
    state.log.push(`«Внешний рай» снижает затраты энергии на передвижение «${selected.card.Name}» на 1.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'swarm-reward') {
    if (Object.keys(selection).length !== 1 || selection.choice !== 'swarm-mana' && selection.choice !== 'swarm-draw') invalidCommand('INVALID_CHOICE')
    const player = match.players[actorSeat]!
    if (selection.choice === 'swarm-draw' && !player.deck.length) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    if (selection.choice === 'swarm-draw') state.players[actorSeat]!.hand.push(state.players[actorSeat]!.deck.shift()!)
    else state.players[actorSeat]!.mana++
    state.pendingChoice = null
    state.version++
    state.log.push(`«Загребущий рой»: ${selection.choice === 'swarm-draw' ? 'взята карта' : 'получена 1 мана'}.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, choice: selection.choice }] }
  }
  if (choice.kind === 'start-turn-weakest-burn') {
    const source = match.board.find(unit => unit.id === choice.sourceUnitId && !unit.dying && !unit.flippedTurns)
    const target = source && weakestCreatureTargets(match.board, source.id).find(unit => unit.id === selection.unitId)
    if (Object.keys(selection).length !== 1 || typeof selection.unitId !== 'string' || !target || !choice.unitIds.includes(target.id) || !match.pendingTurnStart) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    applyTriggeredDamage(state, state.board.find(unit => unit.id === target.id)!, 0, undefined, true, true)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» сжигает выбранное самое слабое существо.`)
    const events = resumeStartTurn(state, state.pendingTurnStart!, random)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: target.id }, ...events] }
  }
  if (choice.kind === 'wismuth-discard') {
    const id = selection.unitId
    const owner = match.players[actorSeat]!
    const index = typeof id === 'string' && choice.unitIds.includes(id) ? owner.hand.findIndex(card => card.instanceId === id && (card.Type === 1 || card.Type === 3)) : -1
    if (Object.keys(selection).length !== 1 || index < 0) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    state.players[actorSeat]!.discard.push(state.players[actorSeat]!.hand.splice(index, 1)[0]!)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» сбрасывает выбранную карту.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind }] }
  }
  if (choice.kind === 'viskas-choice') {
    const state = structuredClone(match)
    const owner = state.players[actorSeat]!
    if (choice.stage === 'option' && Object.keys(selection).length === 1 && selection.choice === 'viskas-draw' && owner.deck.length) {
      owner.hand.push(owner.deck.shift()!)
      state.pendingChoice = null
    } else if (choice.stage === 'option' && Object.keys(selection).length === 1 && selection.choice === 'viskas-discard' && owner.hand.length) {
      state.pendingChoice = { ...choice, stage: 'discard', unitIds: owner.hand.map(card => card.instanceId!).filter(Boolean) }
    } else if (choice.stage === 'discard' && Object.keys(selection).length === 1 && typeof selection.unitId === 'string' && choice.unitIds.includes(selection.unitId)) {
      const index = owner.hand.findIndex(card => card.instanceId === selection.unitId)
      if (index < 0) invalidCommand('INVALID_CHOICE')
      owner.discard.push(owner.hand.splice(index, 1)[0]!)
      state.pendingChoice = null
    } else invalidCommand('INVALID_CHOICE')
    state.version++
    state.log.push(`«Вискас»: выбор эффекта завершён.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind }] }
  }
  if (choice.kind === 'indigolit-heal') {
    const state = structuredClone(match)
    if (Object.keys(selection).length === 1 && (selection.player === 'self' || selection.player === 'opponent')) {
      const seat = selection.player === 'self' ? actorSeat : 1 - actorSeat
      state.players[seat]!.health = Math.min(45, state.players[seat]!.health + 1)
    } else if (Object.keys(selection).length === 1 && typeof selection.unitId === 'string' && choice.unitIds.includes(selection.unitId)) {
      const target = state.board.find(unit => unit.id === selection.unitId && [0, 3].includes(unit.card.Type) && !unit.dying && !unit.flippedTurns)
      if (!target) invalidCommand('INVALID_CHOICE')
      target.health = Math.min(target.maxHealth, target.health + 1)
    } else invalidCommand('INVALID_CHOICE')
    state.pendingChoice = choice.remaining > 1 ? { ...choice, id: `choice_${state.id}_${state.version + 2}_heal`, remaining: choice.remaining - 1 } : null
    state.version++
    state.log.push(`«Индиголит» восстанавливает 1 здоровье; осталось применений: ${choice.remaining - 1}.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, remaining: choice.remaining - 1 }] }
  }
  if (choice.kind === 'spell-dodep') {
    const state = structuredClone(match)
    const owner = state.players[actorSeat]!
    if (choice.stage === 'burn') {
      const id = selection.unitId
      const index = typeof id === 'string' && choice.unitIds.includes(id) ? owner.hand.findIndex(card => card.instanceId === id) : -1
      if (Object.keys(selection).length !== 1 || index < 0) invalidCommand('INVALID_CHOICE')
      const [card] = owner.hand.splice(index, 1)
      burnPileCard(state, actorSeat, card!)
      const roll = adjustGambaRoll(Math.floor(random() * 6) + 1, owner.nextGambaBonus ?? 0)
      owner.nextGambaBonus = 0
      state.pendingChoice = { ...choice, id: `choice_${state.id}_${state.version + 1}_resource`, unitIds: [], stage: 'resource', amount: roll }
      state.version++
      state.log.push(`«Додеп»: карта сожжена; гамба ${roll}.`)
      return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, stage: 'burn' }] }
    }
    if (Object.keys(selection).length !== 1 || selection.choice !== 'mana' && selection.choice !== 'energy' || !choice.amount) invalidCommand('INVALID_CHOICE')
    owner[selection.choice] += choice.amount
    state.pendingChoice = null
    state.version++
    state.log.push(`«Додеп» получает ${choice.amount} ${selection.choice === 'mana' ? 'маны' : 'энергии'}.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, stage: 'resource' }] }
  }
  if (choice.kind === 'ability-librarian') {
    const state = structuredClone(match)
    const player = state.players[actorSeat]!
    if (choice.stage === 'cost') {
      const value = selection.cost
      if (Object.keys(selection).length !== 2 || selection.choice !== 'librarian-cost' || value !== 1 && value !== 2 && value !== 4 || value > player.mana) invalidCommand('INVALID_CHOICE')
      const rarity = value === 1 ? 0 : value === 2 ? 1 : 2
      if (![...player.deck, ...player.discard].some(card => card.Rarity === rarity)) invalidCommand('INVALID_CHOICE')
      state.pendingChoice = { ...choice, id: `choice_${choice.sourceUnitId}_${state.version + 2}`, stage: 'pile', cost: value as 1 | 2 | 4 }
      state.version++
    } else if (choice.stage === 'pile') {
      const pile = selection.pile
      const rarity = choice.cost === 1 ? 0 : choice.cost === 2 ? 1 : 2
      const cards = pile === 'deck' ? player.deck : pile === 'discard' ? player.discard : []
      if (Object.keys(selection).length !== 2 || selection.choice !== 'librarian-pile' || !cards.some(card => card.Rarity === rarity)) invalidCommand('INVALID_CHOICE')
      state.pendingChoice = { ...choice, id: `choice_${choice.sourceUnitId}_${state.version + 2}`, stage: 'card', pile: pile as 'deck' | 'discard', unitIds: cards.filter(card => card.Rarity === rarity && card.instanceId).map(card => card.instanceId!) }
      state.version++
    } else {
      const id = selection.unitId
      const pile = choice.pile === 'deck' ? player.deck : player.discard
      const cardIndex = typeof id === 'string' && choice.unitIds.includes(id) ? pile.findIndex(card => card.instanceId === id && card.Rarity === (choice.cost === 1 ? 0 : choice.cost === 2 ? 1 : 2)) : -1
      if (Object.keys(selection).length !== 1 || cardIndex < 0) invalidCommand('INVALID_CHOICE')
      const [card] = pile.splice(cardIndex, 1)
      if (choice.pile === 'deck') player.deck = shuffle(player.deck, random)
      player.mana -= choice.cost!
      player.nextGambaBonus = 0
      const source = state.board.find(unit => unit.id === choice.sourceUnitId)
      if (source) source.abilityUsed = !isRepeatableAbility(effectiveCardDescription(source.card.Description ?? '', source.item?.Description ?? ''), choice.abilityIndex)
      const roll = adjustGambaRoll(Math.floor(random() * 6) + 1, (source ? gambaModifierForUnit(source) : 0) + (match.players[actorSeat]!.nextGambaBonus ?? 0))
      if (roll <= 3) {
        burnPileCard(state, actorSeat, card!)
      } else player.hand.push(card!)
      state.pendingChoice = null
      state.version++
      state.log.push(`«Библиотекарь» завершает поиск (гамба ${roll}).`)
      return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, result: roll <= 3 ? 'burned' : 'drawn' }] }
    }
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, stage: choice.stage }] }
  }
  if (choice.kind === 'ability-draw-or-limit') {
    if (Object.keys(selection).length !== 1 || selection.choice !== 'draw' && selection.choice !== 'limit') invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const player = state.players[actorSeat]!
    if (selection.choice === 'draw') {
      const card = player.deck.shift()
      if (card) player.hand.push(card)
    } else {
      if (!player.depressiveHandLimit) {
        addTemporaryHandLimit(player, 1, (state.round - 1) * 2 + actorSeat + 2)
      }
    }
    state.pendingChoice = null
    state.version++
    state.log.push(selection.choice === 'draw' ? '«Айсберг» берёт карту.' : '«Айсберг» увеличивает лимит руки на один до следующего хода.')
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, choice: selection.choice }] }
  }
  if (choice.kind === 'ability-conveyor') {
    const id = selection.unitId
    const player = match.players[actorSeat]!
    const cardIndex = typeof id === 'string' && choice.unitIds.includes(id) ? player.hand.findIndex(card => card.instanceId === id) : -1
    if (Object.keys(selection).length !== 1 || cardIndex < 0) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const owner = state.players[actorSeat]!
    const [card] = owner.hand.splice(cardIndex, 1)
    let nextStage: 'discard' | 'burn' | 'save' | null = null
    if (choice.stage === 'discard') { owner.discard.push(card!); nextStage = 'burn' }
    else if (choice.stage === 'burn') {
      burnPileCard(state, choice.owner, card!)
      nextStage = 'save'
    } else {
      owner.saved.push(card!)
      const drawn = owner.deck.shift()
      if (drawn) owner.hand.push(drawn)
    }
    state.version++
    if (nextStage) {
      state.pendingChoice = { ...choice, id: `choice_${choice.sourceUnitId}_${state.version + 1}`, unitIds: owner.hand.map(item => item.instanceId!).filter(Boolean), stage: nextStage }
      state.log.push(nextStage === 'burn' ? '«Конвейерное производство» сбрасывает карту; выберите карту для сжигания.' : '«Конвейерное производство» сжигает карту; выберите карту для сбережения.')
    } else {
      state.pendingChoice = null
      state.log.push('«Конвейерное производство» завершает обработку и берёт карту.')
    }
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, stage: choice.stage }] }
  }
  if (choice.kind === 'spell-save-hand') {
    const ids = selection.unitIds
    const player = match.players[actorSeat]!
    if (Object.keys(selection).length !== 1 || !Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string' || !choice.unitIds.includes(ids[0]) || !player.hand.some(card => card.instanceId === ids[0])) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const owner = state.players[actorSeat]!
    owner.saved.push(owner.hand.splice(owner.hand.findIndex(card => card.instanceId === ids[0]), 1)[0]!)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» сохраняет карту из руки.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, count: 1 }] }
  }
  if (choice.kind === 'spell-discard-hand' || choice.kind === 'hand-limit-discard') {
    const ids = selection.unitIds
    const player = match.players[actorSeat]!
    if (Object.keys(selection).length !== 1 || !Array.isArray(ids) || (choice.kind === 'hand-limit-discard' ? ids.length !== choice.count : ids.length > choice.count) || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !choice.unitIds.includes(id) || !player.hand.some(card => card.instanceId === id))) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const owner = state.players[actorSeat]!
    const indexes = ids.map(id => owner.hand.findIndex(card => card.instanceId === id)).sort((a, b) => b - a)
    for (const index of indexes) owner.discard.push(owner.hand.splice(index, 1)[0]!)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}»: сброшено карт — ${ids.length}.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, count: ids.length }] }
  }
  if (choice.kind === 'spell-search-pile') {
    const player = match.players[actorSeat]!
    const id = selection.unitId
    const index = typeof id === 'string' && choice.unitIds.includes(id) ? player[choice.pile].findIndex(card => card.instanceId === id && Number(card.Cost ?? 0) >= choice.minimumCost) : -1
    if (Object.keys(selection).length !== 1 || index < 0 || !player.hand.some(card => card.instanceId === choice.sourceCardInstanceId)) invalidCommand('INVALID_CHOICE')
    const state = structuredClone(match)
    const owner = state.players[actorSeat]!
    owner.hand.push(owner[choice.pile].splice(index, 1)[0]!)
    finishCastSpell(state, actorSeat, choice.sourceCardInstanceId)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» берёт выбранную карту в руку.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, count: 1 }] }
  }
  let targets: BoardUnit[] = []
  let burnedCardIds: string[] = []
  let cell: { row: number; col: number } | undefined
  if (choice.kind === 'start-turn-burn') {
    const ids = selection.unitIds
    if (Object.keys(selection).length !== 1 || !Array.isArray(ids) || ids.length !== choice.count || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length || !match.pendingTurnStart) invalidCommand('INVALID_CHOICE')
    const hand = match.players[actorSeat]!.hand
    if (ids.some(id => !choice.unitIds.includes(id) || !hand.some(card => card.instanceId === id))) invalidCommand('INVALID_CHOICE')
    burnedCardIds = ids as string[]
  } else if (choice.kind === 'start-turn-shield') {
    const id = selection.unitId
    const source = match.board.find(unit => unit.id === choice.sourceUnitId)
    const target = typeof id === 'string' ? match.board.find(unit => unit.id === id) : undefined
    if (Object.keys(selection).length !== 1 || !match.pendingTurnStart || !source || !target || !choice.unitIds.includes(target.id) || target.card.Type !== 0 || target.dying || target.flippedTurns || target.shield || Math.max(Math.abs(target.row - source.row), Math.abs(target.col - source.col)) !== 1) invalidCommand('INVALID_CHOICE')
    targets = [target]
  } else if (choice.kind === 'spell-move-target') {
    const selectedCell = selection.cell as Record<string, unknown> | undefined
    if (Object.keys(selection).length !== 1 || !selectedCell || Array.isArray(selectedCell) || Object.keys(selectedCell).length !== 2 || !Number.isInteger(selectedCell.row) || !Number.isInteger(selectedCell.col)) invalidCommand('INVALID_COMMAND')
    cell = { row: Number(selectedCell.row), col: Number(selectedCell.col) }
    const target = match.board.find(unit => unit.id === choice.targetUnitId)
    const destinationRow = actorSeat === 0 ? 0 : 4
    const adjacent = Boolean(target && Math.max(Math.abs(cell.row - target.row), Math.abs(cell.col - target.col)) === 1)
    if (!target || actorSeat !== match.current || target.dying || target.flippedTurns || (choice.mode === 'opponent' || choice.mode === 'sideways' ? target.card.Type !== 0 : ![0, 3].includes(target.card.Type)) || choice.mode === 'opponent' && cell.row !== destinationRow || choice.mode === 'adjacent' && !adjacent || choice.mode === 'sideways' && (cell.row !== target.row || Math.abs(cell.col - target.col) !== 1) || target.card.Type === 3 && (cell.row === 0 || cell.row === 4) || !choice.cells.some(option => option.row === cell!.row && option.col === cell!.col) || match.board.some(unit => unit.row === cell!.row && unit.col === cell!.col)) invalidCommand('INVALID_CHOICE')
  } else if (choice.kind === 'ability-move-self') {
    const selectedCell = selection.cell as Record<string, unknown> | undefined
    if (Object.keys(selection).length !== 1 || !selectedCell || Array.isArray(selectedCell) || Object.keys(selectedCell).length !== 2 || !Number.isInteger(selectedCell.row) || !Number.isInteger(selectedCell.col)) invalidCommand('INVALID_COMMAND')
    cell = { row: Number(selectedCell.row), col: Number(selectedCell.col) }
    const source = match.board.find(unit => unit.id === choice.sourceUnitId)
    if (!source || actorSeat !== match.current || movementIsBlocked(match.movementLock ?? null, match.current) || cell.row < 0 || cell.row > 4 || cell.col < 0 || cell.col > 4 || !choice.cells.some(option => option.row === cell!.row && option.col === cell!.col) || match.board.some(unit => unit.row === cell!.row && unit.col === cell!.col)) invalidCommand('INVALID_CHOICE')
  } else if (choice.kind === 'ability-damage-target') {
    const source = match.board.find(unit => unit.id === choice.sourceUnitId)
    if (Object.hasOwn(selection, 'player')) {
      if (Object.keys(selection).length !== 1 || selection.player !== 'opponent' || !choice.playerTarget || !source || !abilityCanTargetPlayer(effectiveCardDescription(source.card.Description ?? '', source.item?.Description ?? ''), choice.abilityIndex, source.row === (actorSeat === 0 ? 0 : 4), source.card.Name)) invalidCommand('INVALID_CHOICE')
    } else {
      const target = typeof selection.unitId === 'string' ? match.board.find(unit => unit.id === selection.unitId) : undefined
      if (Object.keys(selection).length !== 1 || !source || !target || !choice.unitIds.includes(target.id) || target.dying || !canResolveTriggeredEffect(match, target, choice.amount, source)) invalidCommand('INVALID_CHOICE')
      targets = [target]
    }
  } else if (choice.kind === 'ability-put-target-on-deck') {
    const source = match.board.find(unit => unit.id === choice.sourceUnitId)
    const target = typeof selection.unitId === 'string' ? match.board.find(unit => unit.id === selection.unitId) : undefined
    if (Object.keys(selection).length !== 1 || !source || !target || !choice.unitIds.includes(target.id) || target.card.Type !== 0 || target.dying) invalidCommand('INVALID_CHOICE')
    targets = [target]
  } else if (choice.kind === 'ability-sacrifice-building') {
    const source = match.board.find(unit => unit.id === choice.sourceUnitId)
    const target = typeof selection.unitId === 'string' ? match.board.find(unit => unit.id === selection.unitId) : undefined
    if (Object.keys(selection).length !== 1 || !source || !target || !choice.unitIds.includes(target.id) || target.owner !== choice.owner || target.card.Type !== 3 || target.dying || target.flippedTurns || !canResolveTriggeredEffect(match, target, 0, source, true)) invalidCommand('INVALID_CHOICE')
    targets = [target]
  } else if (multi) {
    const ids = selection.unitIds
    if (Object.keys(selection).length !== 1 || !Array.isArray(ids) || ids.length !== choice.count || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) invalidCommand('INVALID_CHOICE')
    const source = match.board.find(unit => unit.id === choice.sourceUnitId)
    const selectedTargets = ids.map(id => match.board.find(unit => unit.id === id))
    if (selectedTargets.some(target => !target) || !source && choice.kind !== 'spell-swap-creatures' && choice.kind !== 'spell-swap-stats' && choice.kind !== 'spell-destroy-creatures') invalidCommand('INVALID_CHOICE')
    targets = selectedTargets as BoardUnit[]
    if (targets.length !== choice.count || targets.some(target => !choice.unitIds.includes(target.id) || target.dying || (choice.kind === 'spell-swap-creatures' || choice.kind === 'spell-swap-stats' || choice.kind === 'spell-destroy-creatures' ? target.card.Type !== 0 : !targetMatchesKind(target.card.Type, choice.targetType)))) invalidCommand('INVALID_CHOICE')
    if (choice.kind === 'ability-damage-targets' && (!source || targets.some(target => !canResolveTriggeredEffect(match, target, choice.amount, source)))) invalidCommand('INVALID_CHOICE')
    const abilityText = source && choice.kind !== 'spell-swap-creatures' && choice.kind !== 'spell-swap-stats' && choice.kind !== 'spell-destroy-creatures' ? abilityDescriptions(effectiveCardDescription(source.card.Description ?? '', source.item?.Description ?? ''))[choice.abilityIndex] ?? '' : ''
    if (source && choice.kind !== 'spell-swap-creatures' && choice.kind !== 'spell-swap-stats' && choice.kind !== 'spell-destroy-creatures' && effectCanTargetEnemy(abilityText)) {
      const clowns = match.board.filter(unit => unit.owner !== choice.owner && !unit.dying && !unit.flippedTurns && (unit.card.Type === 0 || unit.card.Type === 3) && targetMatchesKind(unit.card.Type, choice.targetType) && effectiveCardDescription(unit.card.Description ?? '', unit.item?.Description ?? '').includes('Клоун'))
      if (targets.filter(target => clowns.some(clown => clown.id === target.id)).length < Math.min(choice.count, clowns.length)) invalidCommand('INVALID_CHOICE')
    }
  } else {
    if (typeof selection.unitId !== 'string' || Object.keys(selection).length !== 1) invalidCommand('INVALID_COMMAND')
    const target = match.board.find(unit => unit.id === selection.unitId)
    if (!target || !choice.unitIds.includes(target.id) || target.dying || (choice.kind === 'entry-take-enemy-building' ? target.card.Type !== 3 : choice.kind === 'entry-destroy-building' ? target.card.Type !== 3 : choice.kind === 'entry-damage-target' ? ![0, 3].includes(target.card.Type) : choice.kind === 'entry-move-building' ? target.card.Type !== 3 || target.flippedTurns : choice.kind === 'entry-save-flipped' ? !target.flippedTurns : choice.kind !== 'entry-take-item' && (target.card.Type !== 0 || target.flippedTurns)) || choice.kind === 'entry-take-item' && (!target.item || target.card.Type !== 0) || choice.kind === 'entry-sacrifice-ally-heal' && target.owner !== choice.owner || choice.kind === 'entry-save-allied' && target.owner !== choice.owner || choice.kind === 'entry-take-enemy-building' && target.owner === choice.owner) invalidCommand('INVALID_CHOICE')
    targets = [target]
  }
  const target = targets[0]
  const source = match.board.find(unit => unit.id === choice.sourceUnitId)
  if (choice.kind === 'ability-move-front' && (!source || !forwardMoveDestination(source.owner, source.row, source.col, match.board.some(other => other.row === source.row + (source.owner === 0 ? -1 : 1) && other.col === source.col)))) invalidCommand('INVALID_CHOICE')
  const state = structuredClone(match)
  if (choice.kind === 'entry-move-building') {
    const building = state.board.find(unit => unit.id === target!.id && unit.card.Type === 3 && !unit.dying && !unit.flippedTurns)
    if (!building) invalidCommand('INVALID_CHOICE')
    const cells = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).flatMap(([dr, dc]) => {
      const row = building.row + dr
      const col = building.col + dc
      return row > 0 && row < 4 && col >= 0 && col < 5 && !state.board.some(unit => unit.row === row && unit.col === col) ? [{ row, col }] : []
    })
    if (!cells.length) invalidCommand('INVALID_CHOICE')
    state.pendingChoice = { id: `${choice.id}_move`, owner: choice.owner, kind: 'spell-move-target', sourceUnitId: choice.sourceUnitId, sourceCardName: choice.sourceCardName, targetUnitId: building.id, mode: 'adjacent', cells, unitIds: [] }
    state.version++
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: building.id }] }
  }
  if (choice.kind === 'spell-move-target') {
    const target = state.board.find(unit => unit.id === choice.targetUnitId)!
    target.row = cell!.row
    target.col = cell!.col
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» переносит «${target.card.Name}» на свободный сокет.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, cell }] }
  }
  if (choice.kind === 'start-turn-burn') {
    const player = state.players[choice.owner]!
    for (const id of burnedCardIds) {
      const index = player.hand.findIndex(card => card.instanceId === id)
      const [card] = player.hand.splice(index, 1)
      burnPileCard(state, choice.owner, card!)
    }
    const pendingTurnStart = state.pendingTurnStart!
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» сжигает ${burnedCardIds.length} карт${burnedCardIds.length === 1 ? 'у' : ''} из руки.`)
    const events = resumeStartTurn(state, pendingTurnStart, random)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, count: burnedCardIds.length }, ...events] }
  }
  if (choice.kind === 'start-turn-shield') {
    state.board.find(unit => unit.id === targets[0]!.id)!.shield = true
    const pendingTurnStart = state.pendingTurnStart!
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» даёт щит существу «${targets[0]!.card.Name}».`)
    const events = resumeStartTurn(state, pendingTurnStart, random)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: targets[0]!.id }, ...events] }
  }
  const selectedTargets = targets.map(target => state.board.find(unit => unit.id === target.id)!)
  const selected = selectedTargets[0]!
  if (choice.kind === 'ability-sacrifice-building') {
    const source = state.board.find(unit => unit.id === choice.sourceUnitId)!
    applyTriggeredDamage(state, selected, 0, source, true)
    source.attack += choice.amount
    source.temporaryAttack = (source.temporaryAttack ?? 0) + choice.amount
    state.pendingChoice = null
    state.version++
    state.log.push(`«${source.card.Name}» уничтожает «${selected.card.Name}» и получает +${choice.amount} к атаке до конца хода.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'ability-put-target-on-deck') {
    state.board.splice(state.board.findIndex(unit => unit.id === selected.id), 1)
    state.players[selected.owner]!.deck.unshift(selected.card)
    if (selected.item) state.players[selected.owner]!.discard.push(selected.item)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${source?.card.Name ?? 'Способность'}» отправляет выбранное существо наверх КД владельца.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'ability-damage-target') {
    if (Object.hasOwn(selection, 'player')) {
      const opponent = state.players[1 - actorSeat]!
      opponent.health = Math.max(0, opponent.health - choice.amount)
      if (!opponent.health) { state.status = 'finished'; state.winnerUserId = state.players[actorSeat]!.userId; state.endReason = 'ability' }
    } else {
      const damageSource = state.board.find(unit => unit.id === choice.sourceUnitId)!
      applyTriggeredDamage(state, selected, choice.amount, damageSource)
      if (damageSource.card.Name === 'Герсон Бум') {
        const source = state.board.find(unit => unit.id === damageSource.id)
        if (source) applyTriggeredDamage(state, source, 0, undefined, true, true)
      }
    }
    state.pendingChoice = null
    state.version++
    state.log.push(source?.card.Name === 'Герсон Бум' ? '«Герсон Бум» наносит 15 урона и сжигается.' : Object.hasOwn(selection, 'player') ? `«${source?.card.Name ?? 'Способность'}» наносит ${choice.amount} урона здоровью противника.` : `«${source?.card.Name ?? 'Способность'}» наносит ${choice.amount} урона выбранной карте.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, ...(Object.hasOwn(selection, 'player') ? { player: 'opponent' } : { unitId: selected.id }) }] }
  }
  if (choice.kind === 'entry-sacrifice-ally-heal') {
    const sourceUnit = state.board.find(unit => unit.id === choice.sourceUnitId)
    if (!sourceUnit) invalidCommand('INVALID_CHOICE')
    applyTriggeredDamage(state, selected, 0, sourceUnit, true)
    state.players[choice.owner]!.health = Math.min(45, state.players[choice.owner]!.health + choice.amount)
    state.pendingChoice = null
    state.version++
    state.log.push('«' + choice.sourceCardName + '» уничтожает союзное существо и восстанавливает ' + choice.amount + ' здоровья.')
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'entry-damage-target') {
    const damageSource = state.board.find(unit => unit.id === choice.sourceUnitId)
    if (!damageSource || !canResolveTriggeredEffect(state, selected, choice.amount, damageSource)) invalidCommand('INVALID_CHOICE')
    applyTriggeredDamage(state, selected, choice.amount, damageSource)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}»${choice.roll === undefined ? '' : `: гамба ${choice.roll} —`} наносит ${choice.amount} урона «${selected.card.Name}».`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'entry-type-token') {
    const selected = state.board.find(unit => unit.id === target!.id && unit.card.Type === 0 && !unit.dying && !unit.flippedTurns && !hasWhiteTypeTokens(unit))
    if (!selected) invalidCommand('INVALID_CHOICE')
    state.pendingChoice = { ...choice, id: `${choice.id}_tokens`, unitIds: [], targetUnitId: selected.id, stage: 'token' }
    state.version++
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'entry-take-item') {
    const source = state.board.find(unit => unit.id === choice.sourceUnitId)
    const donor = state.board.find(unit => unit.id === selected.id)!
    if (!source || !transferEquippedItem(state, source, donor)) invalidCommand('INVALID_CHOICE')
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» забирает предмет у «${donor.card.Name}».`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: donor.id }] }
  }
  if (choice.kind === 'entry-destroy-building') {
    applyTriggeredDamage(state, selected, 0, undefined, true)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» уничтожает здание «${selected.card.Name}».`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'entry-stun-creature') {
    selected.stunned = (selected.stunned ?? 0) + choice.turns
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» оглушает «${selected.card.Name}» на ${choice.turns}.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'entry-take-enemy-building') {
    selected.owner = choice.owner
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» получает контроль над зданием «${selected.card.Name}».`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'entry-return-creature') {
    if (!returnCardToHand(state.board, state.players[selected.owner]!.hand, state.players[selected.owner]!.discard, selected.id)) invalidCommand('INVALID_CHOICE')
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» возвращает «${selected.card.Name}» в руку владельца.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'entry-save-allied') {
    const targetIndex = state.board.findIndex(unit => unit.id === selected.id)
    state.board.splice(targetIndex, 1)
    state.players[choice.owner]!.saved.push(selected.card)
    if (selected.item) state.players[choice.owner]!.discard.push(selected.item)
    if (choice.playDeckTop) grantFreeTopDeckCard(state, choice.owner, choice.sourceCardName)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» сохраняет союзную карту «${selected.card.Name}».`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected.id }] }
  }
  if (choice.kind === 'entry-save-flipped') {
    const targetIndex = state.board.findIndex(unit => unit.id === selected.id)
    state.board.splice(targetIndex, 1)
    state.players[choice.owner]!.saved.push(selected.card)
    if (selected.item) state.players[selected.owner]!.discard.push(selected.item)
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» сохраняет перевёрнутую карту.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, count: 1 }] }
  }
  if (choice.kind === 'spell-destroy-creatures') {
    selectedTargets.forEach(target => applyTriggeredDamage(state, target, 0, undefined, true))
    if (choice.sourceCardName === 'Бей своих чтобы чужие боялись') state.board.filter(unit => unit.owner !== choice.owner && unit.card.Type === 0 && !unit.dying).forEach(unit => Object.assign(unit, applyCombatStatChanges(unit, -1, -2)))
    state.pendingChoice = null
    state.version++
    state.log.push(`«${choice.sourceCardName}» уничтожает ${selectedTargets.length} существ.`)
    return { state, events: [{ type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, count: selectedTargets.length }] }
  }
  if (choice.kind === 'ability-move-self') {
    const source = state.board.find(unit => unit.id === choice.sourceUnitId)!
    const from = { row: source.row, col: source.col }
    const speed = effectiveUnitSpeed({ ...source, shield: Boolean(source.shield) })
    source.row = cell!.row
    source.col = cell!.col
    applyMovementTriggers(state, source, from, speed)
    if (choice.stunAdjacent) state.board.filter(unit => unit.id !== source.id && unit.card.Type === 0 && !unit.dying && Math.abs(unit.row - source.row) <= 1 && Math.abs(unit.col - source.col) <= 1 && Math.abs(unit.row - source.row) + Math.abs(unit.col - source.col) > 0).forEach(unit => { unit.stunned = (unit.stunned ?? 0) + choice.stunAdjacent! })
  } else if (choice.kind === 'ability-move-front') {
    const source = state.board.find(unit => unit.id === choice.sourceUnitId)!
    const destination = forwardMoveDestination(source.owner, source.row, source.col, state.board.some(other => other.row === source.row + (source.owner === 0 ? -1 : 1) && other.col === source.col))!
    const from = { row: selected!.row, col: selected!.col }
    const speed = effectiveUnitSpeed({ ...selected!, shield: Boolean(selected!.shield) })
    selected!.row = destination.row
    selected!.col = destination.col
    applyMovementTriggers(state, selected!, from, speed)
  } else if (choice.kind === 'ability-swap-self') {
    const source = state.board.find(unit => unit.id === choice.sourceUnitId)!
    const sourceFrom = { row: source.row, col: source.col }
    const selectedFrom = { row: selected!.row, col: selected!.col }
    const sourceSpeed = effectiveUnitSpeed({ ...source, shield: Boolean(source.shield) })
    const selectedSpeed = effectiveUnitSpeed({ ...selected!, shield: Boolean(selected!.shield) })
    ;[source.row, selected!.row] = [selected!.row, source.row]
    ;[source.col, selected!.col] = [selected!.col, source.col]
    applyMovementTriggers(state, source, sourceFrom, sourceSpeed)
    applyMovementTriggers(state, selected!, selectedFrom, selectedSpeed)
  } else if (choice.kind === 'spell-swap-creatures') {
    const first = selectedTargets[0]!
    const second = selectedTargets[1]!
    const firstFrom = { row: first.row, col: first.col }
    const secondFrom = { row: second.row, col: second.col }
    const firstSpeed = effectiveUnitSpeed({ ...first, shield: Boolean(first.shield) })
    const secondSpeed = effectiveUnitSpeed({ ...second, shield: Boolean(second.shield) })
    ;[first.row, second.row] = [second.row, first.row]
    ;[first.col, second.col] = [second.col, first.col]
    applyMovementTriggers(state, first, firstFrom, firstSpeed)
    applyMovementTriggers(state, second, secondFrom, secondSpeed)
  } else if (choice.kind === 'spell-swap-stats') {
    swapCreatureStats(selectedTargets[0]!, selectedTargets[1]!)
  } else if (choice.kind === 'ability-damage-targets') {
    const source = state.board.find(unit => unit.id === choice.sourceUnitId)
    if (!source) invalidCommand('INVALID_CHOICE')
    selectedTargets.forEach(target => applyTriggeredDamage(state, target, choice.amount, source))
  } else {
    const fullHeal = choice.kind === 'heal-creature' && choice.amount === undefined
    const amount = choice.amount ?? 0
    for (const healingTarget of selectedTargets) {
      const before = healingTarget.health
      healingTarget.health = fullHeal ? healingTarget.maxHealth : Math.min(healingTarget.maxHealth, healingTarget.health + amount)
      if (healingTarget.health > before && healingTarget.card.Type === 0 && !healingTarget.dying && !healingTarget.flippedTurns && state.board.some(unit => unit.owner === healingTarget.owner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Розовый Алмаз')) healingTarget.shield = true
      if (choice.kind === 'ability-heal-creature' && choice.shield) healingTarget.shield = true
      const ameReward = ameHealingReward(state.board, choice.owner, before, healingTarget.maxHealth, healingTarget.health - before)
      if (ameReward) state.board.filter(unit => unit.owner === choice.owner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Аме').forEach(unit => unit.attack++)
      if (choice.kind === 'heal-creature' && choice.flipTurns) {
        healingTarget.flippedTurns = choice.flipTurns
        const trigger = resolveFlipTrigger(healingTarget.card.Name, healingTarget)
        Object.assign(healingTarget, trigger.state)
        const owner = state.players[healingTarget.owner]!
        for (let index = 0; index < trigger.draw && owner.deck.length; index++) owner.hand.push(owner.deck.shift()!)
        owner.mana += trigger.mana
      }
    }
    if (choice.kind === 'heal-creature' && choice.entryTokens) grantEntryEffectTokens(state.board.filter(unit => !unit.dying), choice.owner, choice.entryTokens)
  }
  state.pendingChoice = null
  state.version++
  state.log.push(choice.kind === 'spell-swap-creatures' ? `«${selectedTargets[0]!.card.Name}» и «${selectedTargets[1]!.card.Name}» меняются местами.` : choice.kind === 'spell-swap-stats' ? `«1 апреля»: параметры и жетоны существ обменялись.` : multi ? `«${source?.card.Name ?? 'Способность'}» ${choice.kind === 'ability-damage-targets' ? 'наносит' : 'восстанавливает'} ${choice.amount} ${choice.kind === 'ability-damage-targets' ? 'урона' : 'здоровья'} выбранным целям.` : choice.kind === 'ability-move-self' ? `«${source?.card.Name ?? 'Карта'}» переносится в ${cell!.row + 1}, ${cell!.col + 1}.` : choice.kind === 'ability-move-front' ? `«${selected!.card.Name}» перемещается вперёд.` : choice.kind === 'ability-swap-self' ? `«${source?.card.Name ?? 'Карта'}» меняется местами с «${selected!.card.Name}».` : choice.kind === 'heal-creature' && choice.amount !== undefined ? `«${match.board.find(unit => unit.id === choice.sourceUnitId)?.card.Name ?? 'Вход'}» восстанавливает ${choice.amount} здоровья выбранной цели.` : `«${selected!.card.Name}» полностью восстановлено.`)
  return { state, events: [multi ? { type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitIds: selectedTargets.map(target => target.id) } : choice.kind === 'ability-move-self' ? { type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, cell } : { type: 'choice.resolved', choiceId: choice.id, kind: choice.kind, unitId: selected!.id }] }
}

function equipItem(match: MatchState, actorSeat: number, data: Record<string, unknown>) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  if (Object.keys(data).length !== 3 || typeof data.cardInstanceId !== 'string' || !data.cardInstanceId || typeof data.targetUnitId !== 'string' || !data.targetUnitId || data.payment !== 'mana' && data.payment !== 'health') invalidCommand('INVALID_COMMAND')
  const player = match.players[actorSeat]!
  const card = player.hand.find(item => item.instanceId === data.cardInstanceId)
  const target = match.board.find(unit => unit.id === data.targetUnitId)
  if (!card) invalidCommand('CARD_NOT_IN_HAND')
  const freePlay = Boolean(card.instanceId && player.freePlayCardIds?.includes(card.instanceId))
  if (card.Type !== 1) invalidCommand('UNSUPPORTED_CARD_TYPE')
  if (!target || target.card.Type !== 0 || target.item || target.dying || target.flippedTurns) invalidCommand('INVALID_TARGET')
  // shortcut: effects requiring a trigger or choice reject until MatchState can resolve that lifecycle.
  const catalogedTriggeredItem = card.Name === 'Админский арбалет' && card.Description === 'Досягаемость Безопасность\nВход: Получает -10⚔️.\nКоронный и Ловушка: Убейте существо.' || card.Name === 'Дюп' && card.Description === 'Вход: Уменьшает лимит карт на 2.\nКоронный: Увеличивает лимит карт на 1 а так же получает 1 ⚫\nСпособность 1⚫: Увеличьте или уменьшите требование следующего счёта на 1.' || card.Name === 'Булава' && card.Description === 'Коронный: Выбранное существо получает оглушение 1' || isTauCannon(card) || isShieldItem(card)
    || ['Игла', 'Алмаз', 'Гвоздь грёз', 'Грави пушка', 'Загребущий рой', 'Кирка ФСШ', 'Тулган', 'Magician Red', 'Базука', 'Банхаммер', 'Пилюля'].includes(card.Name)
  if (!catalogedTriggeredItem && /(?:^|\r?\n)\s*(?:Вход|Коронный|Ловушка|Способность)\s*:|Гамба\s*:|гамбу|в начале вашего хода|умирает|сжигается/iu.test(card.Description ?? '')) invalidCommand('UNSUPPORTED_EFFECT')

  let cost = Number(card.Cost ?? 0)
  for (const source of match.board.filter(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Мкия')) cost = scoreDiscountedCost(cost, source.card.Description ?? '', player.hand.length, 2)
  const bloodEmpireActive = match.board.some(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Империя крови')
  if (!freePlay && data.payment === 'health' && !canUseHealthPayment(card.Type, bloodEmpireActive)) invalidCommand('PAYMENT_NOT_ALLOWED')

  const state = structuredClone(match)
  const owner = state.players[actorSeat]!
  if (!freePlay && !payCardCost(owner, cost, data.payment as 'mana' | 'health')) invalidCommand(data.payment === 'health' ? 'NOT_ENOUGH_HEALTH' : 'NOT_ENOUGH_MANA')
  if (freePlay) owner.freePlayCardIds = owner.freePlayCardIds!.filter(id => id !== card.instanceId)
  const index = owner.hand.findIndex(item => item.instanceId === data.cardInstanceId)
  const [item] = owner.hand.splice(index, 1)
  consumeNextScoreAdjustment(owner, item!.Description ?? '')
  const unit = state.board.find(candidate => candidate.id === target.id)!
  unit.item = item!
  applyCardPlayFieldEffects(state, actorSeat, 1)
  unit.attack += Number(item!.Attack ?? 0)
  unit.health += Number(item!.Health ?? 0)
  unit.maxHealth += Number(item!.Health ?? 0)
  if (itemGrantsShield(item!.Description ?? '')) unit.shield = true
  unit.nextAttackNegated = Boolean(rulesForCard(item!.Name).negateNextAttack)
  for (const effect of effectsWhenEquipped(item!.Name)) {
    if (effect.kind === 'decrease-hand-limit') changeHandLimit(owner, -effect.amount)
    if (effect.kind === 'change-attack') unit.attack += effect.amount
  }
  const entryLimitDelta = entryHandLimitDelta(item!.Description ?? '')
  if (entryLimitDelta) changeHandLimit(owner, entryLimitDelta)
  owner.played = true
  state.version++
  state.log.push(`«${item!.Name}» экипирован на «${unit.card.Name}».`)
  return { state, events: [{ type: 'item.equipped', cardId: item!.Id, unitId: unit.id }] }
}

function castSpell(match: MatchState, actorSeat: number, data: Record<string, unknown>, random: () => number) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  if (Object.keys(data).some(key => !['cardInstanceId', 'payment', 'target', 'choice', 'manaAmount', 'healthAmount'].includes(key)) || !['cardInstanceId', 'payment'].every(key => Object.hasOwn(data, key)) || typeof data.cardInstanceId !== 'string' || !data.cardInstanceId || data.payment !== 'mana' && data.payment !== 'health') invalidCommand('INVALID_COMMAND')
  let selectedCell: { row: number; col: number } | undefined
  let selectedUnitId: string | undefined
  let selectedPlayer: number | undefined
  if (data.target !== undefined) {
    if (!data.target || typeof data.target !== 'object' || Array.isArray(data.target)) invalidCommand('INVALID_COMMAND')
    const target = data.target as Record<string, unknown>
    if (Object.keys(target).length === 2 && Number.isInteger(target.row) && Number(target.row) >= 0 && Number(target.row) <= 4 && Number.isInteger(target.col) && Number(target.col) >= 0 && Number(target.col) <= 4) selectedCell = { row: Number(target.row), col: Number(target.col) }
    else if (Object.keys(target).length === 1 && typeof target.unitId === 'string' && target.unitId) selectedUnitId = target.unitId
    else if (Object.keys(target).length === 1 && target.player === 'opponent') selectedPlayer = 1 - actorSeat
    else if (Object.keys(target).length === 1 && target.player === 'self') selectedPlayer = actorSeat
    else invalidCommand('INVALID_COMMAND')
  }
  const player = match.players[actorSeat]!
  const handIndex = player.hand.findIndex(card => card.instanceId === data.cardInstanceId)
  if (handIndex < 0) invalidCommand('CARD_NOT_IN_HAND')
  const card = player.hand[handIndex]!
  const freePlay = Boolean(card.instanceId && player.freePlayCardIds?.includes(card.instanceId))
  if (card.Type !== 2) invalidCommand('UNSUPPORTED_CARD_TYPE')
  const description = (card.Description ?? '').replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim()
  const discordDrama = card.Name === 'Дискорд драма' && /^Потратьте на это заклинание выбранное количество маны, затем нанесите выбранной карте урон равный затраченной мане\.\s*Счёт >7: Целью может быть игрок и урон удваивается\.?$/iu.test(description)
  if (card.Name === 'Дискорд драма' && !discordDrama) invalidCommand('UNSUPPORTED_EFFECT')
  if (discordDrama ? !Number.isInteger(data.manaAmount) || Number(data.manaAmount) < 0 || Number(data.manaAmount) > 1000 : data.manaAmount !== undefined) invalidCommand('INVALID_COMMAND')
  if (discordDrama && Number(data.manaAmount) > player.mana) invalidCommand('NOT_ENOUGH_MANA')
  const roseZlo = card.Name === 'Роза зло' && /^Потратьте столько здоровья, сколько хотите нанести урона выбранной карте\.?$/iu.test(description)
  if (card.Name === 'Роза зло' && !roseZlo) invalidCommand('UNSUPPORTED_EFFECT')
  if (roseZlo ? !Number.isInteger(data.healthAmount) || Number(data.healthAmount) < 0 || Number(data.healthAmount) > 1000 : data.healthAmount !== undefined) invalidCommand('INVALID_COMMAND')
  if (roseZlo && Number(data.healthAmount) >= player.health) invalidCommand('NOT_ENOUGH_HEALTH')
  const dodep = card.Name === 'Додеп' && /^Гамба:\s*Сожгите карту в своей руке, чтобы получить ману или энергию равную числу выпавшему на кубике\.?$/iu.test(description)
  const discardToOpponent = card.Name === 'Подстава' && spellDiscardsToOpponent(description)
  const rottenThief = card.Name === 'Гнилое ворьё' && /^Получите 2 маны или 4 энергии, противник теряет 2 маны или 4 энергии\.?$/iu.test(description)
  if (rottenThief ? data.choice !== 'mana' && data.choice !== 'energy' || data.target !== undefined : data.choice !== undefined) invalidCommand('INVALID_COMMAND')
  const census = card.Name === 'Перепись населения' && /^Получите ману и энергию равную количеству ваших карт в руке\.?$/iu.test(description)
  const wheatSeed = card.Name === 'Засадка пустыни пшеницей' && /^Положите ⚫ на каждый свободный нейтральный сокет\. Если существо наступит на этот сокет, то ⚫ убирается и обладатель существа получает 1 ману\.?$/u.test(description)
  const burnGated = burnGatedSpellOperation(description)
  if (burnGated && !/^Убивает выбранное существо, если вы сожгли свою карту в этом ходу\.?$/iu.test(description)) invalidCommand('UNSUPPORTED_EFFECT')
  const rageUntilDeath = grantsRageUntilOwnerEnd(description)
  if (rageUntilDeath && !/^Дайте существу ярость, в конце хода владельца оно умирает\.?$/iu.test(description)) invalidCommand('UNSUPPORTED_EFFECT')
  const flippedSweep = destroysFlippedThenFlipsSurvivors(description)
  const destroyCreatureCount = spellKillsFlippedCreatureCount(description)
    ? Math.min(match.board.filter(unit => unit.flippedTurns && !unit.dying).length, match.board.filter(unit => unit.card.Type === 0 && !unit.dying && !unit.flippedTurns).length)
    : null
  const swapCreatures = /^Выберите двух существ\s*[-–]\s*они меняются местами\.?$/iu.test(description)
  const swapAprilStats = card.Name === '1 апреля' && spellSwapsCreatureStats(description)
  const auction = spellAuctionsCreatures(description)
  const spellMovesTarget = spellMovesTargetToSocket(description)
  const gambaDamage = gambaDamageOperation(description)
  if (gambaDamage && !/^Гамба:\s*Нанесите выбранной цели столько урона, сколько выпало на кубике\.?$/iu.test(description)) invalidCommand('UNSUPPORTED_EFFECT')
  const discordScore = discordDrama ? discordDramaEffect(description, Number(data.manaAmount), 'player', player.hand.length, player.nextScoreAdjustment) : null
  const sacrificeTwoAllies = spellSacrificesTwoAllies(description)
  const drawAndLimit = spellDrawAndLimitEffect(description)
  const simpleDraw = spellDrawCount(description)
  const healAndDraw = spellHealAndDrawEffect(description)
  const pileSearch = spellPileSearch(description)
  const optionalDiscards = simpleDraw ? scoreExtraDrawCount(description, player.hand.length, player.nextScoreAdjustment) : 0
  if (drawAndLimit && !/^Возьмите\s+\d+\s+карт(?:ы|у)\s+и\s+увеличьте\s+лимит\s+карт\s+противника\s+на\s+\d+\s+до\s+конца\s+его\s+хода\.?$/iu.test(description)) invalidCommand('UNSUPPORTED_EFFECT')
  const areaDamage = spellAreaDamage(description)
  const lineDamage = spellLineDamage(description)
  const lineBuff = spellLineBuff(description)
  const globalFlip = globalFlipTurns(description)
  const burnAllCreatures = spellBurnsAllCreatures(description)
  const burnCreature = spellBurnsCreature(description)
  const killCreature = spellKillsCreature(description)
  const globalCreatureDamage = spellGlobalCreatureDamage(description)
  const destroyBuilding = spellDestroysBuilding(description)
  const targetTransfer = spellTargetTransfer(description)
  const targetedDamage = targetedSpellDamage(description) ?? (gambaDamage || discordDrama || roseZlo ? { amount: 0, targetType: undefined, canTargetPlayer: gambaDamage !== null || Boolean(discordScore?.canTargetPlayer), heal: 0, selfDamage: 0 } : null)
  const savesHandOnCreatureKill = spellSavesHandOnCreatureKill(description)
  const healsCasterOnCreatureKill = spellHealsCasterOnCreatureKill(description)
  const targetedFlip = targetedSpellFlipTurns(description)
  const targetedStun = targetedSpellStunTurns(description)
  const healOrStun = flexibleHealOrStunEffect(description)
  const endTurnDeathBuff = spellBuffToEndTurnDeath(description)
  if (healOrStun && !/^Восстановите\s+\d+\s+здоровья\s+вашему\s+существу,?\s+(?:либо\s+же|или)\s+наложите\s+оглушение\s+\d+\s+на\s+вражеское\.?$/iu.test(description)) invalidCommand('UNSUPPORTED_EFFECT')
  if (areaDamage && !/^Нанесите\s+\d+\s+урона?\s+всем\s+существ[а-яё]*\s+по\s+площади\s+\d+\s*[xх×]\s*\d+\s+сокет(?:а)?\.?$/iu.test(description)) invalidCommand('UNSUPPORTED_EFFECT')
  if (Boolean(areaDamage || lineBuff !== null) !== Boolean(selectedCell) || Boolean(targetedDamage || destroyBuilding || targetTransfer || lineDamage !== null || burnCreature || killCreature || burnGated || rageUntilDeath || targetedFlip !== null || targetedStun !== null || spellMovesTarget || healOrStun || endTurnDeathBuff) !== Boolean(selectedUnitId || selectedPlayer !== undefined) || selectedPlayer !== undefined && (!targetedDamage?.canTargetPlayer || discordDrama && selectedPlayer !== 1 - actorSeat)) invalidCommand('INVALID_TARGET')
  const damageTarget = selectedUnitId ? match.board.find(unit => unit.id === selectedUnitId) : undefined
  if (targetedDamage && selectedUnitId && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || ![0, 3].includes(damageTarget.card.Type) || !targetMatchesKind(damageTarget.card.Type, targetedDamage.targetType))) invalidCommand('INVALID_TARGET')
  if (destroyBuilding && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 3)) invalidCommand('INVALID_TARGET')
  if (targetTransfer && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || ![0, 3].includes(damageTarget.card.Type))) invalidCommand('INVALID_TARGET')
  const moveRow = actorSeat === 0 ? 0 : 4
  const moveCells = spellMovesTarget && damageTarget ? Array.from({ length: 25 }, (_, index) => ({ row: Math.floor(index / 5), col: index % 5 })).filter(cell => (spellMovesTarget === 'opponent' ? cell.row === moveRow : damageTarget.card.Type !== 3 || cell.row > 0 && cell.row < 4) && !match.board.some(unit => unit.row === cell.row && unit.col === cell.col)) : []
  if (spellMovesTarget && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || (spellMovesTarget === 'opponent' ? damageTarget.card.Type !== 0 : ![0, 3].includes(damageTarget.card.Type)) || spellMovesTarget === 'any' && damageTarget.card.Type === 3 && (damageTarget.row === 0 || damageTarget.row === 4) || !moveCells.length)) invalidCommand('INVALID_TARGET')
  if (lineDamage !== null && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns)) invalidCommand('INVALID_TARGET')
  if (burnCreature && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 0)) invalidCommand('INVALID_TARGET')
  if (killCreature && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 0)) invalidCommand('INVALID_TARGET')
  if (burnGated && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 0)) invalidCommand('INVALID_TARGET')
  if (rageUntilDeath && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 0)) invalidCommand('INVALID_TARGET')
  if (targetedFlip !== null && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 0)) invalidCommand('INVALID_TARGET')
  if (targetedStun !== null && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 0)) invalidCommand('INVALID_TARGET')
  if (healOrStun && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 0)) invalidCommand('INVALID_TARGET')
  if (endTurnDeathBuff && (!damageTarget || damageTarget.dying || damageTarget.flippedTurns || damageTarget.card.Type !== 0 || damageTarget.owner !== actorSeat)) invalidCommand('INVALID_TARGET')
  const swapTargets = swapCreatures ? match.board.filter(unit => unit.card.Type === 0 && !unit.dying && !unit.flippedTurns) : []
  if (swapCreatures && swapTargets.length < 2) invalidCommand('INVALID_TARGET')
  if (sacrificeTwoAllies && match.board.filter(unit => unit.owner === actorSeat && unit.card.Type === 0 && !unit.dying && !unit.flippedTurns).length < 2) invalidCommand('INVALID_TARGET')
  const aprilTargets = swapAprilStats ? match.board.filter(unit => unit.card.Type === 0 && !unit.dying) : []
  if (swapAprilStats && aprilTargets.length < 2) invalidCommand('INVALID_TARGET')
  if (sacrificeTwoAllies && match.board.filter(unit => unit.owner === actorSeat && unit.card.Type === 0 && !unit.dying && !unit.flippedTurns).length < 2) invalidCommand('INVALID_TARGET')
  const simpleHealing = /^(?:Вос?становите\s+(?:себе\s+)?\d+\s+здоровья(?:\s+и\s+сожгите\s+карту)?(?:\s+обоим\s+игрокам|\s+за\s+каждое\s+существо\s+на\s+поле)?|Вос?становите\s+себе\s+и\s+своим\s+существам\s+\d+\s+здоровья|Полностью\s+восстанавливает\s+здоровье\s+всех\s+ваших\s+существ\s+и\s+зданий)\.?$/iu.test(description)
  const directDamage = description.match(/^Нанесите\s+(\d+)\s+урона?\s+противнику(?:\s+и\s+восстанавливает\s+вам\s+(\d+)\s+здоровья)?\.?$/iu)
  if (!simpleHealing && !directDamage && !drawAndLimit && !simpleDraw && !healAndDraw && !pileSearch && !swapCreatures && !swapAprilStats && !auction && !sacrificeTwoAllies && !spellMovesTarget && !dodep && destroyCreatureCount === null && !areaDamage && lineDamage === null && lineBuff === null && globalFlip === null && globalCreatureDamage === null && flippedSweep === null && !targetedDamage && !destroyBuilding && !targetTransfer && !burnCreature && !killCreature && !burnGated && !rageUntilDeath && !burnAllCreatures && targetedFlip === null && targetedStun === null && !healOrStun && !endTurnDeathBuff && !discardToOpponent && !rottenThief && !census && !wheatSeed) invalidCommand('UNSUPPORTED_EFFECT')
  const globalHealing = globalHealingOperation(description)
  const directHealing = healAndDraw ? null : playerHealAmount(description)
  if (!globalHealing && directHealing === null && !directDamage && !drawAndLimit && !simpleDraw && !healAndDraw && !pileSearch && !swapCreatures && !swapAprilStats && !auction && !sacrificeTwoAllies && !spellMovesTarget && !dodep && destroyCreatureCount === null && !areaDamage && lineDamage === null && lineBuff === null && globalFlip === null && globalCreatureDamage === null && flippedSweep === null && !targetedDamage && !destroyBuilding && !targetTransfer && !burnCreature && !killCreature && !burnGated && !rageUntilDeath && !burnAllCreatures && targetedFlip === null && targetedStun === null && !healOrStun && !endTurnDeathBuff && !discardToOpponent && !rottenThief && !census && !wheatSeed) invalidCommand('UNSUPPORTED_EFFECT')
  if (endTurnDeathBuff || rageUntilDeath) {
    const probe = structuredClone(match)
    applyTriggeredDamage(probe, probe.board.find(unit => unit.id === selectedUnitId)!, 0, undefined, true)
  }
  if (flippedSweep !== null) {
    const probe = structuredClone(match)
    for (const target of probe.board.filter(unit => unit.flippedTurns && !unit.dying)) applyTriggeredDamage(probe, target, 0, undefined, true)
  }
  if (destroyCreatureCount) {
    const probe = structuredClone(match)
    for (const target of probe.board.filter(unit => unit.card.Type === 0 && !unit.dying && !unit.flippedTurns)) applyTriggeredDamage(probe, target, 0, undefined, true)
  }
  if (burnGated && player.burnedThisTurn) {
    const probe = structuredClone(match)
    applyTriggeredDamage(probe, probe.board.find(unit => unit.id === selectedUnitId)!, 0, undefined, true)
  }
  let cost = Number(card.Cost ?? 0)
  for (const source of match.board.filter(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Мкия')) cost = scoreDiscountedCost(cost, source.card.Description ?? '', player.hand.length, 2)
  const bloodEmpireActive = match.board.some(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Империя крови')
  if (!freePlay && data.payment === 'health' && !canUseHealthPayment(card.Type, bloodEmpireActive)) invalidCommand('PAYMENT_NOT_ALLOWED')

  const state = structuredClone(match)
  const owner = state.players[actorSeat]!
  if (!freePlay && !payCardCost(owner, cost, data.payment as 'mana' | 'health')) invalidCommand(data.payment === 'health' ? 'NOT_ENOUGH_HEALTH' : 'NOT_ENOUGH_MANA')
  if (freePlay) owner.freePlayCardIds = owner.freePlayCardIds!.filter(id => id !== card.instanceId)
  applyCardPlayFieldEffects(state, actorSeat, 2)
  if (discordDrama) owner.mana -= Number(data.manaAmount)
  if (dodep) {
    finishCastSpell(state, actorSeat, card.instanceId!)
    if (owner.hand.length) state.pendingChoice = { id: `choice_${state.id}_${state.version + 1}_burn`, owner: actorSeat, kind: 'spell-dodep', sourceUnitId: '', sourceCardName: card.Name, unitIds: owner.hand.map(item => item.instanceId).filter((id): id is string => Boolean(id)), stage: 'burn' }
    state.version++
    state.log.push(`«${card.Name}» сжигает карту и выбирает ресурс после гамбы.`)
    return { state, events: [{ type: 'spell.cast', cardId: card.Id }] }
  }
  if (pileSearch) {
    const cardIds = owner[pileSearch.pile].filter(card => card.instanceId && Number(card.Cost ?? 0) >= pileSearch.minimumCost).map(card => card.instanceId!)
    if (cardIds.length) {
      state.version++
      state.pendingChoice = { id: `choice_${state.id}_${state.version}`, owner: actorSeat, kind: 'spell-search-pile', sourceUnitId: '', sourceCardName: card.Name, sourceCardInstanceId: card.instanceId!, unitIds: cardIds, ...pileSearch }
      state.log.push(`«${card.Name}»: выберите карту для добора.`)
      return { state, events: [{ type: 'spell.cast', cardId: card.Id }] }
    }
  }
  if (rottenThief) {
    const resource = data.choice as 'mana' | 'energy'
    const opponent = state.players[1 - actorSeat]!
    const stolen = Math.min(opponent[resource], resource === 'mana' ? 2 : 4)
    opponent[resource] -= stolen
    owner[resource] += stolen
  }
  if (rageUntilDeath) {
    const target = state.board.find(unit => unit.id === selectedUnitId)!
    target.temporaryRage = true
    target.expiresAtTurnEnd = true
  }
  if (census) {
    const count = Math.max(0, owner.hand.length - 1)
    owner.mana += count
    owner.energy += count
  }
  if (wheatSeed) {
    state.wheatTokens ??= []
    for (let row = 1; row < 4; row++) for (let col = 0; col < 5; col++) {
      if (!state.board.some(unit => unit.row === row && unit.col === col)) state.wheatTokens.push({ row, col })
    }
  }
  if (burnGated && effectConditionMet(description, owner.burnedThisTurn)) applyTriggeredDamage(state, state.board.find(unit => unit.id === selectedUnitId)!, 0, undefined, true)
  if (drawAndLimit) {
    for (let i = 0; i < drawAndLimit.drawCount && owner.deck.length; i++) owner.hand.push(owner.deck.shift()!)
    const opponent = state.players[1 - actorSeat]!
    if (!opponent.depressiveHandLimit) {
      const expiresAt = (state.round - 1) * 2 + actorSeat + 1
      addTemporaryHandLimit(opponent, drawAndLimit.opponentLimit, expiresAt)
    }
  }
  if (simpleDraw !== null) for (let i = 0; i < simpleDraw + optionalDiscards && owner.deck.length; i++) owner.hand.push(owner.deck.shift()!)
  if (areaDamage) for (const target of spellAreaTargets(state.board, selectedCell as { row: number; col: number }, areaDamage.height, areaDamage.width)) applyTriggeredDamage(state, target, areaDamage.amount)
  if (lineBuff !== null) {
    const cell = selectedCell!
    for (const target of state.board.filter(unit => !unit.dying && !unit.flippedTurns && (unit.row === cell.row || unit.col === cell.col))) Object.assign(target, applyStatBuff(target, lineBuff))
  }
  if (burnCreature) applyTriggeredDamage(state, state.board.find(unit => unit.id === selectedUnitId)!, 0, undefined, true, true)
  if (killCreature) applyTriggeredDamage(state, state.board.find(unit => unit.id === selectedUnitId)!, 0, undefined, true)
  if (burnAllCreatures) for (const target of state.board.filter(unit => unit.card.Type === 0 && !unit.dying && !unit.flippedTurns)) applyTriggeredDamage(state, target, 0, undefined, true, true)
  const applyFlip = (target: BoardUnit, turns: number) => {
    target.flippedTurns = turns
    const trigger = resolveFlipTrigger(target.card.Name, target)
    const triggerOwner = state.players[target.owner]!
    Object.assign(target, trigger.state)
    for (let i = 0; i < trigger.draw && triggerOwner.deck.length; i++) triggerOwner.hand.push(triggerOwner.deck.shift()!)
    triggerOwner.mana += trigger.mana
  }
  if (flippedSweep !== null) {
    for (const target of state.board.filter(unit => unit.flippedTurns && !unit.dying)) applyTriggeredDamage(state, target, 0, undefined, true)
    for (const target of state.board.filter(unit => !unit.dying)) applyFlip(target, flippedSweep)
  }
  if (globalFlip !== null) for (const target of state.board.filter(unit => !unit.dying)) applyFlip(target, globalFlip)
  if (targetedFlip !== null) {
    const target = state.board.find(unit => unit.id === selectedUnitId)!
    applyFlip(target, targetedFlip)
  }
  if (targetedStun !== null) {
    const target = state.board.find(unit => unit.id === selectedUnitId)!
    target.stunned = (target.stunned ?? 0) + targetedStun
  }
  if (healOrStun) {
    const target = state.board.find(unit => unit.id === selectedUnitId)!
    if (target.owner !== actorSeat) target.stunned = (target.stunned ?? 0) + healOrStun.turns
    else {
      const before = target.health
      target.health = Math.min(target.maxHealth, target.health + healOrStun.heal)
      if (target.health > before && state.board.some(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Розовый Алмаз')) target.shield = true
      if (ameHealingReward(state.board, actorSeat, before, target.maxHealth, target.health - before)) state.board.filter(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Аме').forEach(unit => unit.attack++)
    }
  }
  if (endTurnDeathBuff) {
    const target = state.board.find(unit => unit.id === selectedUnitId)!
    target.attack += endTurnDeathBuff.attack
    target.health += endTurnDeathBuff.health
    target.maxHealth += endTurnDeathBuff.health
    target.speed -= endTurnDeathBuff.speed
    target.expiresAtTurnEnd = true
  }
  if (lineDamage !== null) {
    const target = state.board.find(unit => unit.id === selectedUnitId)!
    for (const unit of state.board.filter(unit => unit.card.Type === 0 && !unit.dying && !unit.flippedTurns && (unit.row === target.row || unit.col === target.col))) applyTriggeredDamage(state, unit, lineDamage)
  }
  if (globalCreatureDamage !== null) for (const target of state.board.filter(unit => unit.card.Type === 0 && !unit.dying)) applyTriggeredDamage(state, target, globalCreatureDamage)
  if (destroyBuilding) applyTriggeredDamage(state, state.board.find(unit => unit.id === selectedUnitId)!, 0, undefined, true)
  if (targetTransfer) {
    const targetIndex = state.board.findIndex(unit => unit.id === selectedUnitId)
    const target = state.board.splice(targetIndex, 1)[0]!
    const targetOwner = state.players[target.owner]!
    ;(targetTransfer === 'hand' ? targetOwner.hand : targetOwner.discard).push(target.card)
    if (target.item) {
      if (!hasBurnTrait(target.item.Description ?? '')) targetOwner.discard.push(target.item)
      else if ((targetOwner.nextBurnToSave ?? 0) > 0) { targetOwner.nextBurnToSave!--; targetOwner.saved.push(target.item) }
      else { targetOwner.burned.push(target.item); if (target.owner === state.current) targetOwner.burnedThisTurn = true; gainBurnTriggerTokens(state.board, target.owner) }
    }
  }
  let saveHandCard = false
  if (targetedDamage) {
    const damageAmount = gambaDamage ? adjustGambaRoll(Math.floor(random() * 6) + 1, owner.nextGambaBonus ?? 0) : discordDrama ? discordDramaEffect(description, Number(data.manaAmount), selectedPlayer !== undefined ? 'player' : 'card', player.hand.length, player.nextScoreAdjustment).damage : roseZlo ? Number(data.healthAmount) : targetedDamage.amount
    if (gambaDamage) owner.nextGambaBonus = 0
    if (roseZlo) owner.health -= damageAmount
    if (selectedPlayer !== undefined) {
      const target = state.players[selectedPlayer]!
      target.health = Math.max(0, target.health - damageAmount)
      if (!target.health) { state.status = 'finished'; state.winnerUserId = state.players[winnerWhenPlayerFalls(selectedPlayer as 0 | 1)]!.userId; state.endReason = 'spell' }
    } else if (selectedUnitId) {
      const target = state.board.find(unit => unit.id === selectedUnitId)!
      const isCreature = target.card.Type === 0
      const targetHealth = target.health
      applyTriggeredDamage(state, target, damageAmount, undefined, false, false, spellFlipOnKill(description) ?? 0)
      if (healsCasterOnCreatureKill && isCreature && !state.board.includes(target)) owner.health = Math.min(45, owner.health + targetHealth)
      if (savesHandOnCreatureKill && isCreature && !state.board.some(unit => unit.id === selectedUnitId)) saveHandCard = true
    }
    owner.health = Math.min(45, owner.health + targetedDamage.heal)
    owner.health = Math.max(0, owner.health - targetedDamage.selfDamage)
    if (!owner.health) { state.status = 'finished'; state.winnerUserId = state.players[winnerWhenPlayerFalls(actorSeat as 0 | 1)]!.userId; state.endReason = 'spell' }
  }
  if (swapCreatures || swapAprilStats) {
    const spell = owner.hand.splice(handIndex, 1)[0]!
    owner.discard.push(spell)
    consumeNextScoreAdjustment(owner, spell.Description ?? '')
    owner.played = true
    state.pendingChoice = { id: `choice_${state.id}_${state.version + 1}`, owner: actorSeat, kind: swapAprilStats ? 'spell-swap-stats' : 'spell-swap-creatures', sourceUnitId: '', sourceCardName: spell.Name, unitIds: (swapAprilStats ? aprilTargets : swapTargets).map(unit => unit.id), count: 2 }
    state.version++
    state.log.push(`${owner.name} применяет «${spell.Name}» и выбирает существ для рокировки.`)
    return { state, events: [{ type: 'spell.cast', cardId: spell.Id }] }
  }
  if (spellMovesTarget) {
    const spell = owner.hand[handIndex]!
    finishCastSpell(state, actorSeat, spell.instanceId!)
    state.pendingChoice = { id: `choice_${state.id}_${state.version + 1}`, owner: actorSeat, kind: 'spell-move-target', sourceUnitId: '', sourceCardName: spell.Name, targetUnitId: damageTarget!.id, mode: spellMovesTarget, cells: moveCells, unitIds: [] }
    state.version++
    state.log.push(`${owner.name} applies «${spell.Name}» and selects an empty socket.`)
    return { state, events: [{ type: 'spell.cast', cardId: spell.Id }] }
  }
  const spell = owner.hand[handIndex]!
  const healPlayer = (target: PlayerState, amount: number) => { target.health = Math.min(45, target.health + amount) }
  if (globalHealing?.kind === 'heal-both-players') state.players.forEach(target => healPlayer(target, globalHealing.amount))
  else if (globalHealing?.kind === 'heal-controller-and-units') {
    healPlayer(owner, globalHealing.amount)
    state.board.filter(unit => unit.owner === actorSeat && unit.card.Type === 0 && !unit.dying && !unit.flippedTurns).forEach(unit => {
      const before = unit.health
      unit.health = Math.min(unit.maxHealth, unit.health + globalHealing.amount)
      if (unit.health > before && state.board.some(source => source.owner === actorSeat && !source.dying && !source.flippedTurns && source.card.Name === 'Розовый Алмаз')) unit.shield = true
      const reward = ameHealingReward(state.board, actorSeat, before, unit.maxHealth, unit.health - before)
      if (reward) state.board.filter(source => source.owner === actorSeat && !source.dying && !source.flippedTurns && source.card.Name === 'Аме').forEach(source => { source.attack += reward })
    })
  } else if (globalHealing?.kind === 'heal-controller-per-creature') {
    const amount = countCreaturesOnField(state.board.map(unit => ({ type: unit.card.Type, dying: unit.dying }))) * globalHealing.amount
    healPlayer(owner, amount)
  } else if (globalHealing?.kind === 'heal-own-board') {
    for (const unit of state.board.filter(unit => unit.owner === actorSeat && !unit.dying && !unit.flippedTurns)) {
      const before = unit.health
      unit.health = unit.maxHealth
      if (unit.card.Type === 0 && unit.health > before && state.board.some(source => source.owner === actorSeat && !source.dying && !source.flippedTurns && source.card.Name === 'Розовый Алмаз')) unit.shield = true
      const reward = ameHealingReward(state.board, actorSeat, before, unit.maxHealth, unit.health - before)
      if (reward) state.board.filter(source => source.owner === actorSeat && !source.dying && !source.flippedTurns && source.card.Name === 'Аме').forEach(source => { source.attack += reward })
    }
  } else if (directHealing !== null) healPlayer(owner, directHealing)
  if (directDamage) {
    const targetSeat = 1 - actorSeat
    const target = state.players[targetSeat]!
    target.health = Math.max(0, target.health - Number(directDamage[1]))
    if (directDamage[2]) healPlayer(owner, Number(directDamage[2]))
    if (target.health <= 0) {
      state.status = 'finished'
      state.winnerUserId = state.players[winnerWhenPlayerFalls(targetSeat as 0 | 1)]!.userId
      state.endReason = 'spell'
    }
  }

  if (auction) {
    const creatures = state.board.filter(unit => unit.card.Type === 0 && !unit.dying)
    const survivor = creatures[Math.min(creatures.length - 1, Math.floor(random() * creatures.length))]
    for (const target of creatures) if (target !== survivor && state.board.includes(target)) applyTriggeredDamage(state, target, 0, undefined, true)
  }
  finishCastSpell(state, actorSeat, spell.instanceId!, discardToOpponent ? 1 - actorSeat : actorSeat)
  state.version++
  if (saveHandCard) {
    const cardIds = owner.hand.map(card => card.instanceId).filter((id): id is string => Boolean(id))
    if (cardIds.length) state.pendingChoice = { id: `choice_${state.id}_${state.version}`, owner: actorSeat, kind: 'spell-save-hand', sourceUnitId: '', sourceCardName: spell.Name, unitIds: cardIds, count: 1 }
  }
  if (optionalDiscards) {
    const cardIds = owner.hand.map(card => card.instanceId).filter((id): id is string => Boolean(id))
    if (cardIds.length) state.pendingChoice = { id: `choice_${state.id}_${state.version}`, owner: actorSeat, kind: 'spell-discard-hand', sourceUnitId: '', sourceCardName: spell.Name, unitIds: cardIds, count: Math.min(optionalDiscards, cardIds.length) }
  }
  if (destroyCreatureCount || sacrificeTwoAllies) {
    const targets = state.board.filter(unit => unit.card.Type === 0 && !unit.dying && !unit.flippedTurns && (!sacrificeTwoAllies || unit.owner === actorSeat))
    state.pendingChoice = { id: `choice_${state.id}_${state.version}`, owner: actorSeat, kind: 'spell-destroy-creatures', sourceUnitId: '', sourceCardName: spell.Name, unitIds: targets.map(unit => unit.id), count: sacrificeTwoAllies ? 2 : destroyCreatureCount! }
  }
  state.log.push(`${owner.name} применяет «${spell.Name}».`)
  return { state, events: [{ type: 'spell.cast', cardId: spell.Id }] }
}

function takeSavedCard(match: MatchState, actorSeat: number, data: Record<string, unknown>) {
  if (actorSeat !== match.current) invalidCommand('NOT_YOUR_TURN')
  if (Object.keys(data).length !== 1 || typeof data.cardInstanceId !== 'string' || !data.cardInstanceId) invalidCommand('INVALID_COMMAND')
  const index = match.players[actorSeat]!.saved.findIndex(card => card.instanceId === data.cardInstanceId)
  if (index < 0) invalidCommand('CARD_NOT_IN_SAVED')
  const state = structuredClone(match)
  const player = state.players[actorSeat]!
  player.hand.push(player.saved.splice(index, 1)[0]!)
  state.version++
  state.log.push(`${player.name} берёт карту из сбережений.`)
  return { state, events: [{ type: 'card.takenFromSaved', seat: actorSeat, count: 1 }] }
}

export function applyCommand(match: MatchState, actorSeat: number, command: { action: string; data: Record<string, unknown> }, random: () => number = Math.random) {
  if (match.status !== 'active') throw Object.assign(new Error('Match is not active'), { code: 'MATCH_NOT_ACTIVE' })
  if (actorSeat !== 0 && actorSeat !== 1) throw Object.assign(new Error('Invalid player seat'), { code: 'NOT_A_PARTICIPANT' })
  if (match.pendingChoice && command.action !== 'choice.resolve' && command.action !== 'match.concede') invalidCommand('CHOICE_PENDING')
  if (command.action === 'turn.end') return settleCommand(endTurn(match, actorSeat, command.data, random))
  if (command.action === 'unit.move') return settleCommand(moveUnit(match, actorSeat, command.data, random))
  if (command.action === 'unit.attack') return settleCommand(attackUnit(match, actorSeat, command.data, random))
  if (command.action === 'unit.attackPlayer') return settleCommand(attackPlayer(match, actorSeat, command.data))
  if (command.action === 'ability.use') return settleCommand(useAbility(match, actorSeat, command.data, random))
  if (command.action === 'item.equip') return settleCommand(equipItem(match, actorSeat, command.data))
  if (command.action === 'card.play') return settleCommand(playCard(match, actorSeat, command.data, random))
  if (command.action === 'card.takeSaved') return settleCommand(takeSavedCard(match, actorSeat, command.data))
  if (command.action === 'spell.cast') return settleCommand(castSpell(match, actorSeat, command.data, random))
  if (command.action === 'choice.resolve') {
    const result = resolveChoice(match, actorSeat, command.data, random)
    const followUp = result.state.pendingTurnStart && !result.state.pendingChoice ? resumeStartTurn(result.state, result.state.pendingTurnStart, random) : []
    return settleCommand({ state: result.state, events: [...result.events, ...followUp] })
  }
  if (command.action !== 'match.concede') invalidCommand('UNSUPPORTED_ACTION')
  if (Object.keys(command.data).length) throw Object.assign(new Error('Invalid concession payload'), { code: 'INVALID_COMMAND' })
  const state = structuredClone(match)
  state.status = 'finished'
  state.winnerUserId = state.players[actorSeat === 0 ? 1 : 0]!.userId
  state.endReason = 'concede'
  state.version++
  return settleCommand({ state, events: [{ type: 'match.conceded', seat: actorSeat }] })
}
function pileChoiceOptions(cards: Card[], ids: readonly string[]) {
  return cards.filter(card => card.instanceId && ids.includes(card.instanceId)).map(card => ({ unitId: card.instanceId!, name: card.Name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.unitId.localeCompare(b.unitId))
}

export function projectForPlayer(match: MatchState, seat: number) {
  const librarianCost = match.pendingChoice?.kind === 'ability-librarian' ? match.pendingChoice.cost : undefined
  if (seat !== 0 && seat !== 1) throw new RangeError('Invalid player seat')
  const playerView = ({ userId, name, health, mana, energy, limit, played, hand }: PlayerState) =>
    ({ userId, name, health, mana, energy, limit, played, handCount: hand.length })
  const boardView = match.board.map(({ id, card, item, owner, row, col, health, maxHealth, attack, speed, shield, flippedTurns, stunned, abilityUsed, blackTokens, typeTokens, temporaryHealth, temporaryAttack, energyCostReduction, v1RangedCrown, summoned, attacks }) => {
    const flipped = Boolean(flippedTurns)
    return {
      id, owner, row, col,
      card: flipped ? { Name: 'Перевёрнутая карта', Description: '', Type: -1 } : Object.fromEntries(Object.entries(card).filter(([key]) => ['Id', 'Name', 'Description', 'Type', 'Attack', 'Health', 'Speed', 'Cost'].includes(key))),
      ...(!flipped && item ? { item: Object.fromEntries(Object.entries(item).filter(([key]) => ['Name', 'Description', 'Type', 'Attack', 'Health', 'Speed', 'Cost'].includes(key))) } : {}),
      health: flipped ? 0 : health, maxHealth: flipped ? 0 : maxHealth, attack: flipped ? 0 : attack, speed: flipped ? 0 : speed,
      ...(!flipped && shield !== undefined ? { shield } : {}),
      ...(flippedTurns === undefined ? {} : { flippedTurns }),
      ...(!flipped && stunned !== undefined ? { stunned } : {}),
      ...(!flipped ? { summoned, attacks } : {}),
      ...(!flipped && abilityUsed !== undefined ? { abilityUsed } : {}),
      ...(!flipped && blackTokens !== undefined ? { blackTokens } : {}),
      ...(!flipped && typeTokens !== undefined ? { typeTokens } : {}),
      ...(!flipped && temporaryHealth ? { temporaryHealth } : {}),
      ...(!flipped && temporaryAttack ? { temporaryAttack } : {}),
      ...(!flipped && energyCostReduction ? { energyCostReduction } : {}),
      ...(!flipped && v1RangedCrown ? { v1RangedCrown } : {}),
    }
  })
  return {
    mySeat: seat,
    public: {
      id: match.id, version: match.version, status: match.status, rulesVersion: match.rulesVersion, winnerUserId: match.winnerUserId, endReason: match.endReason,
      current: match.current, round: match.round, players: match.players.map(playerView), board: boardView, movementLock: match.movementLock ?? null, wheatTokens: structuredClone(match.wheatTokens ?? []),
    },
    private: { seat, handLimitLocked: Boolean(match.players[seat]!.depressiveHandLimit), saved: match.players[seat]!.saved.map(({ Id, instanceId, Name, Description, Type, Cost }) => ({ Id, instanceId, Name, Description, Type, Cost })), hand: match.players[seat]!.hand.map(card => ({ ...structuredClone(card), ...(card.instanceId && match.players[seat]!.freePlayCardIds?.includes(card.instanceId) ? { freeToPlay: true } : {}) })), deckCount: match.players[seat]!.deck.length, burnedThisTurn: match.players[seat]!.burnedThisTurn, nextBurnToSave: match.players[seat]!.nextBurnToSave ?? 0, nextGambaBonus: match.players[seat]!.nextGambaBonus ?? 0, nextScoreAdjustment: match.players[seat]!.nextScoreAdjustment, pendingChoice: match.pendingChoice?.owner === seat ? {
      id: match.pendingChoice.id, kind: match.pendingChoice.kind,
      ...(match.pendingChoice.kind === 'spell-search-pile' ? { pile: match.pendingChoice.pile, minimumCost: match.pendingChoice.minimumCost } : {}), ...(match.pendingChoice.kind === 'death-save-deck-cards' ? { totalCost: match.pendingChoice.totalCost } : {}),
      sourceCardName: ('sourceCardName' in match.pendingChoice ? match.pendingChoice.sourceCardName : undefined) ?? match.board.find(unit => unit.id === match.pendingChoice!.sourceUnitId)?.card.Name ?? '',
      ...('amount' in match.pendingChoice ? { amount: match.pendingChoice.amount } : {}), ...(match.pendingChoice.kind === 'entry-damage-target' && match.pendingChoice.roll !== undefined ? { roll: match.pendingChoice.roll } : {}), ...(match.pendingChoice.kind === 'entry-stun-creature' ? { turns: match.pendingChoice.turns } : {}), ...('stage' in match.pendingChoice ? { stage: match.pendingChoice.stage } : {}), ...(match.pendingChoice.kind === 'entry-type-token' && match.pendingChoice.stage === 'token' ? { remaining: match.pendingChoice.remaining, choices: Array.from({ length: 6 }, (_, tokenClass) => ({ label: `Типаж ${tokenClass + 1}`, value: { tokenClass } })) } : {}),
      ...(match.pendingChoice.kind === 'viskas-choice' && match.pendingChoice.stage === 'option' ? { choices: [{ label: 'Взять карту', value: { choice: 'viskas-draw' as const } }, { label: 'Сбросить карту', value: { choice: 'viskas-discard' as const } }] } : {}), ...(match.pendingChoice.kind === 'death-intivi' ? { cardName: match.pendingChoice.itemName, choices: [{ label: 'Оставить в руке', value: { choice: 'keep' as const } }, { label: 'Сбросить предмет', value: { choice: 'discard' as const } }] } : {}), ...(match.pendingChoice.kind === 'swarm-reward' ? { choices: [{ label: 'Получить 1 ману', value: { choice: 'swarm-mana' as const } }, ...(match.players[seat]!.deck.length ? [{ label: 'Взять карту', value: { choice: 'swarm-draw' as const } }] : [])] } : {}), ...(match.pendingChoice.kind === 'indigolit-heal' ? { remaining: match.pendingChoice.remaining, choices: [{ label: 'Вылечить себя', value: { player: 'self' as const } }, { label: 'Вылечить соперника', value: { player: 'opponent' as const } }] } : {}), ...(match.pendingChoice.kind === 'ability-librarian' ? { choices: match.pendingChoice.stage === 'cost'
        ? ([1, 2, 4] as const).filter(cost => cost <= match.players[seat]!.mana && [...match.players[seat]!.deck, ...match.players[seat]!.discard].some(card => card.Rarity === (cost === 1 ? 0 : cost === 2 ? 1 : 2))).map(cost => ({ label: `${cost} маны · ${cost === 1 ? 'обычная' : cost === 2 ? 'редкая' : 'легендарная'} карта`, value: { choice: 'librarian-cost' as const, cost } }))
        : match.pendingChoice.stage === 'pile' ? (['deck', 'discard'] as const).filter(pile => (pile === 'deck' ? match.players[seat]!.deck : match.players[seat]!.discard).some(card => card.Rarity === (librarianCost === 1 ? 0 : librarianCost === 2 ? 1 : 2))).map(pile => ({ label: pile === 'deck' ? 'Колода' : 'Сброс', value: { choice: 'librarian-pile' as const, pile } })) : [] } : {}),
      ...(match.pendingChoice.kind === 'ability-damage-target' ? { playerTarget: match.pendingChoice.playerTarget } : {}),
      ...(match.pendingChoice.kind === 'death-weaken-target' ? { playerTarget: match.pendingChoice.playerTarget } : {}),
      ...(match.pendingChoice.kind === 'ability-damage-targets' || match.pendingChoice.kind === 'ability-heal-targets' || match.pendingChoice.kind === 'spell-swap-creatures' || match.pendingChoice.kind === 'spell-swap-stats' || match.pendingChoice.kind === 'spell-destroy-creatures' || match.pendingChoice.kind === 'start-turn-burn' || match.pendingChoice.kind === 'spell-save-hand' || match.pendingChoice.kind === 'death-save-deck-cards' || match.pendingChoice.kind === 'spell-discard-hand' || match.pendingChoice.kind === 'hand-limit-discard' ? { count: match.pendingChoice.count, ...('targetType' in match.pendingChoice && match.pendingChoice.targetType ? { targetType: match.pendingChoice.targetType } : {}) } : {}),
      ...(match.pendingChoice.kind === 'ability-move-self' || match.pendingChoice.kind === 'spell-move-target' || match.pendingChoice.kind === 'start-turn-sent-croix' && match.pendingChoice.stage === 'cell' ? { cells: structuredClone(match.pendingChoice.cells) } : {}),
      ...(match.pendingChoice.kind === 'spell-move-target' ? { mode: match.pendingChoice.mode } : {}),
      options: match.pendingChoice.kind === 'spell-search-pile' ? pileChoiceOptions(match.players[seat]![match.pendingChoice.pile], match.pendingChoice.unitIds) : match.pendingChoice.kind === 'death-save-deck-cards' ? pileChoiceOptions(match.players[seat]!.deck, match.pendingChoice.unitIds) : match.pendingChoice.kind === 'death-intivi' ? [] : match.pendingChoice.kind === 'crown-play-saved-spell' ? match.players[seat]!.saved.filter(card => card.instanceId && (match.pendingChoice && 'unitIds' in match.pendingChoice ? match.pendingChoice.unitIds : []).includes(card.instanceId)).map(card => ({ unitId: card.instanceId!, name: card.Name })) : match.pendingChoice.kind === 'start-turn-sent-croix' && match.pendingChoice.stage === 'card' || match.pendingChoice.kind === 'viskas-choice' && match.pendingChoice.stage === 'discard' || match.pendingChoice.kind === 'wismuth-discard' || match.pendingChoice.kind === 'start-turn-burn' || match.pendingChoice.kind === 'spell-save-hand' || match.pendingChoice.kind === 'spell-discard-hand' || match.pendingChoice.kind === 'hand-limit-discard' || match.pendingChoice.kind === 'ability-conveyor' || match.pendingChoice.kind === 'spell-dodep' && match.pendingChoice.stage === 'burn' ? match.players[seat]!.hand.filter(card => card.instanceId && (match.pendingChoice && 'unitIds' in match.pendingChoice ? match.pendingChoice.unitIds : []).includes(card.instanceId)).map(card => ({ unitId: card.instanceId!, name: card.Name }))
        : match.pendingChoice.kind === 'ability-librarian' && match.pendingChoice.stage === 'card' ? pileChoiceOptions([...match.players[seat]!.deck, ...match.players[seat]!.discard], match.pendingChoice.unitIds)
          : 'unitIds' in match.pendingChoice ? match.pendingChoice.unitIds.flatMap(unitId => { const unit = match.board.find(candidate => candidate.id === unitId); return unit ? [{ unitId, name: unit.flippedTurns ? `Перевёрнутая карта · ${unit.row + 1}, ${unit.col + 1}` : unit.card.Name }] : [] }) : []
    } : null },
  }
}
