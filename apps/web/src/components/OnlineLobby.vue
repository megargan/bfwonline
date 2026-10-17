<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { cardCatalog } from '../../../../packages/game-data/src'
import { loadSavedDecks, type SavedDeck } from '../deck-library'
import { abilityCostOnField, abilityCostResource, abilityDescriptions, abilityDrawCount, burnGatedSpellOperation, destroysFlippedThenFlipsSurvivors, discordDramaEffect, flexibleHealOrStunEffect, globalFlipTurns, globalHealingOperation, gambaDamageOperation, grantsRageUntilOwnerEnd, isRepeatableAbility, playerHealAmount, spellAreaDamage, spellBuffToEndTurnDeath, spellBurnsAllCreatures, spellBurnsCreature, spellDestroysBuilding, spellDrawCount, spellDrawAndLimitEffect, spellHealAndDrawEffect, spellPileSearch, spellGlobalCreatureDamage, spellKillsCreature, spellKillsFlippedCreatureCount, spellLineBuff, spellLineDamage, spellMovesTargetToSocket, spellTargetTransfer, targetedAbilityOperation, targetedSpellDamage, targetedSpellFlipTurns, targetMatchesKind } from '../../../../packages/game-core/src/card-effects'
import type { GameCommand, SpellCastData } from '../../../../packages/contracts/src'
import type { PendingChoiceKind } from '../../../../packages/game-core/src'
import { shouldApplyMatchSnapshot, shouldApplyRoomView } from '../online-snapshot'
import GameField from './GameField.vue'
import CardInspector from './CardInspector.vue'
import { trackPointerDrag } from '../pointer-drag'
import { canMoveTo, canActWhileFlipped, canAttackBoardCard, canAttackTarget, creaturePushLine, effectiveUnitSpeed, rulesForCard, unitCanMoveAndAttack, unitMovementBlocked } from '../../../../packages/game-core/src/card-effects'

type User = { id: string; username: string; displayName: string; avatarUrl: string | null; avatarVersion: number }
type Room = {
  id: string; code: string; ownerUserId: string; status: 'waiting' | 'playing'; revision: number; matchId: string | null
  participants: { userId: string; username: string; displayName: string; ready: boolean; connected: boolean }[]
  myDeckId: string | null; myDeckRevision: number | null; canStart: boolean
}
type MatchSnapshot = {
  public: { id: string; version: number; round: number; current: number; movementLock: number | null; status: string; winnerUserId?: string; players: { name: string; avatarUrl: string | null; health: number; mana: number; energy: number; limit: number; handCount: number; played: boolean }[]; board: { id: string; owner: number; row: number; col: number; card: { Name: string; Description?: string; Type: number; Speed?: number }; item?: { Name: string; Description?: string; Type: number; Attack?: number; Health?: number; Speed?: number; Cost?: number }; health: number; maxHealth: number; attack: number; speed: number; shield?: boolean; flippedTurns?: number; stunned?: number; summoned?: number; attacks?: number; abilityUsed?: boolean; blackTokens?: number; typeTokens?: number[]; temporaryHealth?: number; temporaryAttack?: number; energyCostReduction?: number }[]; wheatTokens: { row: number; col: number }[] }
  private: { seat: number; handLimitLocked: boolean; saved: { instanceId: string; Name: string }[]; hand: { Id: string; instanceId: string; Name: string; Description?: string; Cost: number; Type: number; freeToPlay?: boolean }[]; deckCount: number; burnedThisTurn: boolean; nextBurnToSave: number; nextGambaBonus: number; nextScoreAdjustment: number; pendingChoice: { id: string; kind: PendingChoiceKind; sourceCardName: string; cardName?: string; pile?: 'deck' | 'burned'; minimumCost?: number; amount?: number; roll?: number; turns?: number; count?: number; stage?: 'target' | 'token' | 'option' | 'discard' | 'burn' | 'save' | 'cost' | 'pile' | 'card' | 'resource' | 'cell'; playerTarget?: boolean; remaining?: number; targetType?: 'creature' | 'building'; mode?: 'any' | 'opponent' | 'adjacent' | 'sideways'; cells?: { row: number; col: number }[]; choices?: { label: string; value: { choice: 'librarian-cost'; cost: 1 | 2 | 4 } | { choice: 'librarian-pile'; pile: 'deck' | 'discard' } | { choice: 'viskas-draw' | 'viskas-discard' | 'swarm-draw' | 'swarm-mana' | 'keep' | 'discard' } | { player: 'self' | 'opponent' } | { tokenClass: number } }[]; options: { unitId: string; name: string }[] } | null }
}
type PendingCommand = { type: 'game.command'; payload: GameCommand }
type TurnEndData = Extract<GameCommand, { action: 'turn.end' }>['data']
type EndTurnOption = 'no_penalty' | 'discard_and_decrease_limit' | 'increase_limit_after_round_5'

function pendingChoicePrompt(choice: MatchSnapshot['private']['pendingChoice']) {
  if (choice?.kind === 'crown-play-saved-spell') return 'TheVolkeR: выберите заклинание из сбережений для бесплатного розыгрыша.'
  if (choice?.kind === 'spell-move-target' && choice.mode === 'sideways') return '«Громила»: выберите свободную клетку слева или справа от цели.'
  if (choice?.kind === 'entry-move-building') return 'Выберите здание для перемещения.'
  return 'Выберите цель эффекта.'
}

const emit = defineEmits<{ back: [] }>()
const user = defineModel<User | null>('account', { default: null })
const room = ref<Room | null>(null)
const matchSnapshot = ref<MatchSnapshot | null>(null)
const pendingCommand = ref<PendingCommand | null>(null)
const discordDramaMana = ref(0)
const roseZloHealth = ref(0)
const selectedChoiceTargets = ref<{ choiceId: string; unitIds: string[] }>({ choiceId: '', unitIds: [] })
const endTurnOption = ref<EndTurnOption>('no_penalty')
const selectedDiscards = ref<string[]>([])
const selectedMoveUnitId = ref('')
const selectedPlayCardId = ref('')
const selectedSpellCell = ref<{ row: number; col: number } | null>(null)
const selectedSpellUnitId = ref('')
const playPayment = ref<'mana' | 'health'>('mana')
const playWithHorny = ref(false)
const decks = ref<SavedDeck[]>([])
const decksLoading = ref(true)
const playableDecks = computed(() => decks.value.filter(deck => deck.playable))
const selectedDeckId = ref('')
const csrfToken = defineModel<string>('csrfToken', { default: '' })
const username = ref('')
const password = ref('')
const joinCode = ref('')
const registering = ref(false)
const busy = ref(false)
const message = ref('')
const connected = ref(false)
const socket = ref<WebSocket | null>(null)
let reconnectTimer: number | undefined
let closing = false
const selectedDeck = computed(() => decks.value.find(deck => deck.id === (room.value?.myDeckId ?? selectedDeckId.value)) ?? null)
const selectedPlayCard = computed(() => matchSnapshot.value?.private.hand.find(card => card.instanceId === selectedPlayCardId.value) ?? null)
const selectedSpellDiscordDrama = computed(() => selectedPlayCard.value?.Name === 'Дискорд драма' && /^Потратьте на это заклинание выбранное количество маны, затем нанесите выбранной карте урон равный затраченной мане\.\s*Счёт >7: Целью может быть игрок и урон удваивается\.?$/iu.test(selectedPlayCard.value.Description ?? ''))
const selectedSpellRoseZlo = computed(() => selectedPlayCard.value?.Name === 'Роза зло' && /^Потратьте столько здоровья, сколько хотите нанести урона выбранной карте\.?$/iu.test(selectedPlayCard.value.Description ?? ''))
const selectedSpellDiscordDramaCanTargetPlayer = computed(() => Boolean(selectedSpellDiscordDrama.value && discordDramaEffect(selectedPlayCard.value?.Description ?? '', discordDramaMana.value, 'player', matchSnapshot.value?.private.hand.length ?? 0, matchSnapshot.value?.private.nextScoreAdjustment ?? 0).canTargetPlayer))
const selectedSpellSupported = computed(() => {
  const card = selectedPlayCard.value
  if (!card || card.Type !== 2) return false
  const description = (card.Description ?? '').replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim()
  const healing = /^(?:Вос?становите\s+(?:себе\s+)?\d+\s+здоровья(?:\s+и\s+сожгите\s+карту)?(?:\s+обоим\s+игрокам|\s+за\s+каждое\s+существо\s+на\s+поле)?|Вос?становите\s+себе\s+и\s+своим\s+существам\s+\d+\s+здоровья|Полностью\s+восстанавливает\s+здоровье\s+всех\s+ваших\s+существ\s+и\s+зданий)\.?$/iu.test(description) && (globalHealingOperation(description) !== null || playerHealAmount(description) !== null)
  const damage = /^Нанесите\s+\d+\s+урона?\s+противнику(?:\s+и\s+восстанавливает\s+вам\s+\d+\s+здоровья)?\.?(?:\r?\nСжигаеться\.?)?$/iu.test(description)
  const area = spellAreaDamage(description) !== null
  const line = spellLineDamage(description) !== null
  const lineBuff = spellLineBuff(description) !== null
  const burnCreature = spellBurnsCreature(description)
  return healing || damage || area || line || lineBuff || selectedSpellDiscordDrama.value || selectedSpellRoseZlo.value || spellMovesTargetToSocket(description) !== null || gambaDamageOperation(description) !== null || spellDrawCount(description) !== null || spellDrawAndLimitEffect(description) !== null || spellHealAndDrawEffect(description) !== null || spellPileSearch(description) !== null || globalFlipTurns(description) !== null || destroysFlippedThenFlipsSurvivors(description) !== null || burnCreature || spellKillsCreature(description) || spellKillsFlippedCreatureCount(description) || selectedSpellBurnGated.value || spellBurnsAllCreatures(description) || targetedSpellFlipTurns(description) !== null || flexibleHealOrStunEffect(description) !== null || spellBuffToEndTurnDeath(description) !== null || grantsRageUntilOwnerEnd(description) || spellGlobalCreatureDamage(description) !== null || spellDestroysBuilding(description) || spellTargetTransfer(description) !== null || targetedSpellDamage(description) !== null || /^Выберите двух существ\s*[-–]\s*они меняются местами\.?$/iu.test(description) || selectedSpellResourceChoice.value || card.Name === 'Перепись населения' && /^Получите ману и энергию равную количеству ваших карт в руке\.?$/iu.test(description) || selectedSpellWheatSeed.value
})
const selectedSpellResourceChoice = computed(() => {
  const card = selectedPlayCard.value
  const description = (card?.Description ?? '').replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim()
  return card?.Name === 'Гнилое ворьё' && /^Получите 2 маны или 4 энергии, противник теряет 2 маны или 4 энергии\.?$/iu.test(description)
})
const selectedSpellWheatSeed = computed(() => {
  const card = selectedPlayCard.value
  const description = (card?.Description ?? '').replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim()
  return card?.Name === 'Засадка пустыни пшеницей' && /^Положите ⚫ на каждый свободный нейтральный сокет\. Если существо наступит на этот сокет, то ⚫ убирается и обладатель существа получает 1 ману\.?$/u.test(description)
})
const selectedSpellBurnGated = computed(() => burnGatedSpellOperation(selectedPlayCard.value?.Description ?? '') !== null)
const selectedSpellDamage = computed(() => targetedSpellDamage(selectedPlayCard.value?.Description ?? ''))
const selectedSpellLineDamage = computed(() => spellLineDamage(selectedPlayCard.value?.Description ?? '') !== null)
const selectedSpellLineBuff = computed(() => spellLineBuff(selectedPlayCard.value?.Description ?? '') !== null)
const selectedSpellBurnCreature = computed(() => spellBurnsCreature(selectedPlayCard.value?.Description ?? ''))
const selectedSpellKillCreature = computed(() => spellKillsCreature(selectedPlayCard.value?.Description ?? '') || selectedSpellBurnGated.value)
const selectedSpellBuilding = computed(() => spellDestroysBuilding(selectedPlayCard.value?.Description ?? ''))
const selectedSpellTransfer = computed(() => spellTargetTransfer(selectedPlayCard.value?.Description ?? ''))
const selectedSpellFlip = computed(() => targetedSpellFlipTurns(selectedPlayCard.value?.Description ?? ''))
const selectedSpellHealOrStun = computed(() => flexibleHealOrStunEffect(selectedPlayCard.value?.Description ?? ''))
const selectedSpellTemporaryBuff = computed(() => spellBuffToEndTurnDeath(selectedPlayCard.value?.Description ?? ''))
const selectedSpellRage = computed(() => grantsRageUntilOwnerEnd(selectedPlayCard.value?.Description ?? ''))
const selectedSpellMove = computed(() => spellMovesTargetToSocket(selectedPlayCard.value?.Description ?? ''))
const selectedSpellGamba = computed(() => gambaDamageOperation(selectedPlayCard.value?.Description ?? '') !== null)
const selectedSpellMoveCells = computed(() => {
  const target = matchSnapshot.value?.public.board.find(unit => unit.id === selectedSpellUnitId.value)
  const seat = matchSnapshot.value?.private.seat
  if (!target || seat === undefined || !selectedSpellMove.value) return []
  return Array.from({ length: 25 }, (_, index) => ({ row: Math.floor(index / 5), col: index % 5 })).filter(cell => (selectedSpellMove.value === 'opponent' ? cell.row === (seat === 0 ? 0 : 4) : target.card.Type !== 3 || cell.row > 0 && cell.row < 4) && !matchSnapshot.value?.public.board.some(unit => unit.row === cell.row && unit.col === cell.col))
})
type BoardUnit = MatchSnapshot['public']['board'][number]
const cardInspector = ref<InstanceType<typeof CardInspector> | null>(null)
function inspectCard(event: PointerEvent | FocusEvent) {
  const source = (event.target as Element).closest<HTMLElement>('.hand-card, .slot')
  if (!source || dragging.value || event.relatedTarget instanceof Node && source.contains(event.relatedTarget)) return
  const snapshot = matchSnapshot.value
  const handCard = snapshot?.private.hand.find(card => card.instanceId === source.dataset.cardInstance)
  const unit = source.matches('.slot') ? boardUnitAt(Number(source.dataset.row), Number(source.dataset.col)) : null
  const card = handCard ?? (unit && !unit.flippedTurns ? unit.card : null)
  if (!card || card.Type < 0) { cardInspector.value?.hide(); return }
  const catalogCard = cardCatalog.find(candidate => candidate.Name === card.Name)
  cardInspector.value?.show({ ...catalogCard, ...card, Cost: handCard ? handCard.freeToPlay ? 0 : handCard.Cost : catalogCard?.Cost }, source)
}
function leaveInspectedCard(event: PointerEvent | FocusEvent) {
  const source = (event.target as Element).closest('.hand-card, .slot')
  if (!source || event.relatedTarget instanceof Node && source.contains(event.relatedTarget)) return
  if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.card-inspector')) return
  cardInspector.value?.hide()
}
const myTurn = computed(() => Boolean(matchSnapshot.value && matchSnapshot.value.public.current === matchSnapshot.value.private.seat))
const canInteract = computed(() => Boolean(myTurn.value && connected.value && !pendingCommand.value && !matchSnapshot.value?.private.pendingChoice && matchSnapshot.value?.public.status === 'active'))
const showTurnEnd = ref(false)
const drag = ref<{ kind: 'hand' | 'unit'; id: string; x: number; y: number } | null>(null)
const dragging = ref(false)
const dragPosition = ref({ left: 0, top: 0 })
const dragSize = ref({ width: 120, height: 160 })
const dragTarget = ref<{ row: number; col: number; mode: 'move' | 'attack' | 'play' } | { mode: 'player' } | null>(null)
const dragCard = computed(() => drag.value?.kind === 'hand' ? matchSnapshot.value?.private.hand.find(card => card.instanceId === drag.value?.id) : matchSnapshot.value?.public.board.find(unit => unit.id === drag.value?.id)?.card)
let stopDrag: (() => void) | null = null
let ignoreDragClick = false
let dragSourceSize = { width: 120, height: 160 }
const descriptionOf = (unit: BoardUnit) => (unit.card.Description ?? '') + '\n' + (unit.item?.Description ?? '')
function unitReady(unit: BoardUnit) {
  const snapshot = matchSnapshot.value
  return Boolean(snapshot && unit.owner === snapshot.private.seat && !unit.stunned && (!unit.flippedTurns || canActWhileFlipped(descriptionOf(unit))) && unitCanMoveAndAttack(unit, snapshot.public.board) && (unit.card.Type === 3 || (unit.summoned ?? snapshot.public.round) < snapshot.public.round || descriptionOf(unit).includes('Порыв') || snapshot.public.board.some(other => other.owner === unit.owner && other.card.Name === 'Вечная ночь')))
}
function canDirectAttack(unit: BoardUnit) {
  return unitReady(unit) && unit.card.Type === 0 && unit.row === (matchSnapshot.value?.private.seat === 0 ? 0 : 4) && (unit.attacks ?? 0) < (descriptionOf(unit).includes('Ярость') ? 2 : 1) && !rulesForCard(unit.card.Name).cannotDamagePlayerDirectly && !rulesForCard(unit.item?.Name ?? '').cannotDamagePlayerDirectly
}
const selectedDirectAttackUnit = computed(() => matchSnapshot.value?.public.board.find(unit => unit.id === selectedMoveUnitId.value && canDirectAttack(unit)) ?? null)
function unitDropMode(unit: BoardUnit, row: number, col: number): 'move' | 'attack' | null {
  const snapshot = matchSnapshot.value
  if (!snapshot || !unitReady(unit) || unit.card.Type !== 0) return null
  const target = boardUnitAt(row, col)
  if (!target) return snapshot.public.movementLock !== snapshot.private.seat && !unitMovementBlocked(unit) && canMoveTo(unit.row, unit.col, row, col, unit.item?.Name === 'Банни хоп') && snapshot.public.players[snapshot.private.seat]!.energy >= effectiveUnitSpeed({ ...unit, shield: Boolean(unit.shield) }) ? 'move' : null
  const reach = descriptionOf(unit).includes('Досягаемость')
  const audit = snapshot.public.board.some(other => other.owner === unit.owner && other.card.Name === 'Журнал аудита')
  return canMoveTo(unit.row, unit.col, row, col, reach) && (unit.attacks ?? 0) < (descriptionOf(unit).includes('Ярость') ? 2 : 1) && canAttackTarget(unit.card.Name, unit.owner, target.owner, descriptionOf(unit).includes('Безопасность')) && canAttackBoardCard(unit.card.Name, descriptionOf(target), Boolean(target.flippedTurns), reach) && (target.flippedTurns || !descriptionOf(target).includes('Невидимость') || audit) ? 'attack' : null
}
function clearDrag() {
  stopDrag?.(); stopDrag = null
  drag.value = null; dragging.value = false; dragTarget.value = null
  document.body.style.userSelect = ''
}
function beginDrag(event: PointerEvent, kind: 'hand' | 'unit', id: string) {
  if (event.button !== 0 || !canInteract.value || showTurnEnd.value) return
  if (kind === 'hand' && matchSnapshot.value?.public.players[matchSnapshot.value.private.seat]?.played) return
  const unit = kind === 'unit' ? matchSnapshot.value?.public.board.find(unit => unit.id === id) : null
  if (kind === 'unit' && (!unit || !unitReady(unit) || unit.card.Type !== 0)) return
  clearDrag()
  const source = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dragSourceSize = { width: source.width, height: source.height }
  dragSize.value = { ...dragSourceSize }
  drag.value = { kind, id, x: event.clientX, y: event.clientY }
  stopDrag = trackPointerDrag(event, moveDrag, endDrag)
}
function moveDrag(event: PointerEvent) {
  const pending = drag.value
  if (!pending || !canInteract.value) { clearDrag(); return }
  if (!dragging.value && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return
  if (!dragging.value) {
    dragging.value = true
    cardInspector.value?.hide()
    if (pending.kind === 'hand') { if (selectedPlayCardId.value !== pending.id) selectCardToPlay(pending.id) }
    else { selectedPlayCardId.value = ''; selectedMoveUnitId.value = pending.id }
    document.body.style.userSelect = 'none'
  }
  dragTarget.value = null
  dragSize.value = { ...dragSourceSize }
  dragPosition.value = { left: event.clientX, top: event.clientY }
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  const profile = hit?.closest('.player-profile.opponent')
  const unit = pending.kind === 'unit' ? matchSnapshot.value?.public.board.find(unit => unit.id === pending.id) : null
  if (profile && unit && canDirectAttack(unit)) {
    const rect = profile.getBoundingClientRect()
    dragTarget.value = { mode: 'player' }
    dragPosition.value = { left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 }
    return
  }
  const cell = hit?.closest<HTMLElement>('.slot')
  if (!cell) return
  const row = Number(cell.dataset.row), col = Number(cell.dataset.col)
  const mode = unit ? unitDropMode(unit, row, col) : !boardCellDisabled(row, col) ? 'play' : null
  if (!mode) return
  const rect = cell.getBoundingClientRect()
  dragTarget.value = { row, col, mode }
  dragSize.value = { width: rect.width, height: rect.height }
  dragPosition.value = { left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 }
}
function endDrag(event: PointerEvent) {
  const pending = drag.value, target = dragTarget.value, active = dragging.value
  clearDrag()
  if (!active) return
  if (event.type !== 'pointercancel' && canInteract.value && target && pending) {
    if (target.mode === 'player') attackPlayer()
    else if (pending.kind === 'unit') {
      if (target.mode === 'move') moveUnitTo(target.row, target.col)
      else { const unit = boardUnitAt(target.row, target.col); if (unit) attackUnit(unit.id) }
    } else {
      clickBoardCell(target.row, target.col)
      if (selectedPlayCard.value?.Type === 2 && !selectedSpellResourceChoice.value && !selectedSpellDiscordDrama.value && !selectedSpellRoseZlo.value) castSelectedSpell()
    }
  }
  ignoreDragClick = true
  window.setTimeout(() => { ignoreDragClick = false }, 0)
}
function requestEndTurn() {
  if (!canInteract.value) return
  if (matchSnapshot.value?.public.players[matchSnapshot.value.private.seat]?.played) endTurn()
  else showTurnEnd.value = true
}
watch(() => [matchSnapshot.value?.public.id, matchSnapshot.value?.public.current, matchSnapshot.value?.public.version, connected.value], () => {
  clearDrag()
  cardInspector.value?.hide()
  if (!myTurn.value) { selectedPlayCardId.value = ''; selectedMoveUnitId.value = ''; showTurnEnd.value = false }
})
onUnmounted(clearDrag)

function acceptMatchSnapshot(snapshot: MatchSnapshot) {
  if (!shouldApplyMatchSnapshot(room.value?.matchId ?? null, matchSnapshot.value, snapshot)) return
  matchSnapshot.value = snapshot
  if (snapshot.public.status === 'active' && user.value && room.value?.myDeckId) {
    try { localStorage.setItem(`bfw:last-played-deck:${user.value.id}`, room.value.myDeckId) } catch { /* The game remains available when browser storage is disabled. */ }
  }
}

function acceptRoomView(candidate: Room) {
  if (!shouldApplyRoomView(room.value, candidate)) return false
  room.value = candidate
  selectedDeckId.value = candidate.myDeckId ?? preferredDeckId()
  if (matchSnapshot.value && matchSnapshot.value.public.id !== candidate.matchId) matchSnapshot.value = null
  return true
}

const selectedUnitAbilities = computed(() => {
  const snapshot = matchSnapshot.value
  const unit = snapshot?.public.board.find(candidate => candidate.id === selectedMoveUnitId.value && candidate.owner === snapshot.private.seat)
  if (!snapshot || !unit) return []
  const descriptionWithItem = `${unit.card.Description ?? ''}\n${unit.item?.Description ?? ''}`
  return abilityDescriptions(descriptionWithItem).flatMap((description, index) => {
    const effect = targetedAbilityOperation(descriptionWithItem, index)
    const simpleCreatureDamage = effect?.kind === 'damage-target' && effect.targetType === 'creature' && /^Способность[^:]*:\s*Наносит\s+\d+\s+урон\s+выбранному\s+существу\.?$/iu.test(description)
    const suzyDamage = unit.card.Name === 'Сьюзи' && unit.card.Description === 'Способность 5: Наносит 8 урона выбранной цели.' && description === unit.card.Description
    const backstageMove = unit.card.Name === 'Закулисье' && unit.card.Type === 3 && unit.card.Description === 'Способность 5⭐: Выбранное существо отправляется наверх КД владельца.' && description === unit.card.Description
    const noovseLock = unit.card.Name === 'Noovse' && unit.card.Description === 'Способность 6⭐: На следующем ходу все существа не могут передвигаться до начала вашего следующего хода.' && description === unit.card.Description
    const icebergChoice = unit.card.Name === 'Айсберг' && unit.card.Type === 3 && unit.card.Description === 'Постоянно: Когда вы сжигаете карту, то получает 1 ⚫\nСпособность 1 ⚫🔁: Возьмите карту или увеличьте лимит карт на 1 до конца следующего хода.' && description === abilityDescriptions(descriptionWithItem)[index]
    const lucioHealth = unit.card.Name === 'Лусио' && unit.card.Description === 'Способность 10: Все ваши существа получают 10 до начала вашего следующего хода.' && description === unit.card.Description
    const gambaAbility = unit.card.Name === 'Фанат геншина' && unit.card.Type === 0 && effect?.kind === 'gamba-destroy-or-gain-mana' && description === abilityDescriptions(unit.card.Description ?? '')[index]
    const generatorDraw = unit.card.Name === 'Генератор потех' && unit.card.Type === 0 && unit.card.Description?.replace(/\r\n/gu, '\n') === 'Невидимость\nСпособность 2⭐: Возьмите карту\nСжигается' && index === 0 && description === abilityDescriptions(unit.card.Description ?? '')[index] && abilityDrawCount(description, index) === 1
    const conveyor = unit.card.Name === 'Конвейерное производство' && unit.card.Type === 3 && unit.card.Description?.replace(/\r\n/gu, '\n') === 'Способность 1⭐: Сбросьте 1 карту, сожгите 1 карту, сберегите 1 карту, возьмите 1 карту.' && index === 0 && description === abilityDescriptions(unit.card.Description ?? '')[index]
    const librarian = unit.card.Name === 'Библиотекарь' && unit.card.Type === 0 && unit.card.Description?.replace(/\r\n/gu, '\n').trimEnd() === 'Способность N⭐: Если вы потратили 1 ману, то вытащите любую обычную карту, если 2 любую редкую карту, если 4 любую легендарную карту из КД, КС. \nПостоянно: Гамба: Если вы вытаскиваете карту при помощи Библиотекаря.\n1-3 - Вытащенная карта сжигается.\n4-6 - Ничего не происходит.' && index === 0 && description === abilityDescriptions(unit.card.Description ?? '')[index]
    const tauCannon = unit.card.Type === 0 && unit.item?.Name === 'Тау-пушка' && unit.item.Description?.replace(/\r\n/gu, '\n') === 'Способность 0: Получает 1\nПостоянно: Если у этого существа стат атаки 5 или более, то оно умирает а тау пушка сжигаеться.' && index === abilityDescriptions(unit.card.Description ?? '').length && description === abilityDescriptions(unit.item.Description)[0]
    const bibiSacrifice = unit.card.Name === 'Биби' && unit.card.Type === 0 && unit.card.Description === 'Способность 0⭐: Уничтожает ваше здание что бы дать получить +4⚔️ до конца хода.' && description === unit.card.Description
    const multiTarget = (effect?.kind === 'damage-targets' || effect?.kind === 'heal-targets') && /^Способность[^:]*:\s*(?:Нанесите\s+\d+\s+урона?\s+(?:трём|трем|двум|двумя|\d+)\s+выбранным\s+разным\s+цел(?:ям|я)|Восстановите\s+\d+\s+здоровья?\s+(?:трём|трем|двум|двумя|\d+)\s+выбранным\s+разным\s+цел(?:ям|я))\.?$/iu.test(description)
    if (!effect && !generatorDraw && !tauCannon && !conveyor && !librarian || effect && !simpleCreatureDamage && !suzyDamage && !backstageMove && !noovseLock && !lucioHealth && !icebergChoice && !bibiSacrifice && !gambaAbility && !generatorDraw && !tauCannon && !conveyor && !librarian && !multiTarget && !['adjust-next-score', 'gain-black-token', 'gain-player-mana', 'gain-self-shield', 'next-attack-splash', 'move-target-front', 'move-self', 'swap-self'].includes(effect.kind) && !(effect.kind === 'heal-target' && effect.targetType === 'creature') || unit.abilityUsed && !isRepeatableAbility(descriptionWithItem, index)) return []
    return [{ index, description, operation: effect?.kind ?? (tauCannon ? 'gain-attack' : conveyor ? 'conveyor' : librarian ? 'librarian' : 'draw'), tokens: unit.blackTokens ?? 0, cost: abilityCostOnField(descriptionWithItem, index, snapshot.private.seat, snapshot.public.board), resource: abilityCostResource(descriptionWithItem, index) }]
  })
})
const bloodEmpireActive = computed(() => Boolean(matchSnapshot.value?.public.board.some(unit => unit.owner === matchSnapshot.value?.private.seat && unit.card.Name === 'Империя крови' && !unit.flippedTurns)))
const classNames = ['Тфер', 'Симп', 'Метрокоп', 'Токсик', 'Темщик', 'Гэмблер']

async function api(path: string, options: { method?: string; body?: unknown } = {}) {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (!['GET', 'HEAD'].includes(method)) {
    if (csrfToken.value) headers['x-csrf-token'] = csrfToken.value
  }
  const response = await fetch(`/api/v1${path}`, {
    method, headers, credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  if (response.status === 204) return null
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error ?? `HTTP_${response.status}`)
  return data
}

function setError(error: unknown) {
  const code = error instanceof Error ? error.message : 'REQUEST_FAILED'
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: 'Неверный логин или пароль.', USERNAME_TAKEN: 'Этот логин уже занят.',
    ORIGIN_FORBIDDEN: 'Запрос пришёл с неизвестного адреса.', CSRF_INVALID: 'Обновите страницу и повторите действие.',
    PLAYER_OFFLINE: 'Сначала подключитесь к лобби по сети.', ROOM_FULL: 'В комнате уже два игрока.',
    ROOM_NOT_FOUND: 'Комната не найдена или уже закрыта.', ROOM_ALREADY_PLAYING: 'Эта комната уже начала партию.',
    ACTIVE_CONNECTION_EXISTS: 'Аккаунт уже подключён в другой вкладке.', DECK_NOT_PLAYABLE: 'Выберите готовую колоду на 30 карт.',
    INVALID_DECK: 'Проверьте название и состав колоды.', DECK_LIMIT: 'Достигнут лимит: 100 колод.', CANNOT_JOIN_SELF: 'Нельзя присоединиться к собственной комнате.',
    DECK_CHANGED: 'Колода изменилась. Выберите её и подтвердите готовность снова.',
    PLAYERS_NOT_READY: 'Оба игрока должны быть в сети и подтвердить колоды.',
    MATCH_NOT_FOUND: 'Матч не найден или вы не участвуете в нём.', MATCH_NOT_ACTIVE: 'Партия уже завершена.',
    COMMAND_ID_CONFLICT: 'Команда с таким идентификатором уже использована.', STALE_STATE_VERSION: 'Состояние обновилось. Повторите действие.',
    NOT_A_PARTICIPANT: 'Вы не участвуете в этой партии.',
    NOT_YOUR_TURN: 'Сейчас ход соперника.', INVALID_COMMAND: 'Выбранное действие больше недоступно. Обновите состояние партии.', CHOICE_PENDING: 'Сначала завершите текущий выбор.', INVALID_CHOICE: 'Эта цель больше недоступна.',
    UNIT_NOT_FOUND: 'Эта карта больше не на поле.', UNIT_CANNOT_MOVE: 'Эта карта сейчас не может передвигаться.', UNIT_CANNOT_ATTACK: 'Эта карта сейчас не может атаковать.', UNIT_CANNOT_USE_ABILITY: 'Эта карта сейчас не может использовать способность.', ABILITY_ALREADY_USED: 'Способность уже использована в этом ходу.', ATTACKS_EXHAUSTED: 'Эта карта уже атаковала в этом ходу.', OUT_OF_RANGE: 'Цель находится вне досягаемости.', MOVEMENT_BLOCKED: 'В этот ход движение заблокировано.', INVALID_TARGET: 'Выберите допустимую клетку или цель.', NOT_ENOUGH_ENERGY: 'Не хватает энергии для перемещения.', NOT_ENOUGH_MANA: 'Не хватает маны.', NOT_ENOUGH_BLACK_TOKENS: 'Не хватает чёрных жетонов.',
    CARD_NOT_IN_SAVED: 'Этой карты больше нет в сбережениях.', CARD_NOT_IN_HAND: 'Эта карта больше не в руке.', UNSUPPORTED_CARD_TYPE: 'Этот тип карты пока нельзя разыграть онлайн.', UNSUPPORTED_EFFECT: 'Этот эффект карты пока нельзя выполнить онлайн.', PAYMENT_NOT_ALLOWED: 'Эту карту нельзя оплатить здоровьем.', NOT_ENOUGH_HEALTH: 'Нужно оставить себе хотя бы 1 здоровье.',
    AVATAR_INVALID: 'Не удалось прочитать изображение.', AVATAR_UNSUPPORTED: 'Выберите JPEG, PNG или WebP.',
    AVATAR_ANIMATED: 'Анимированные изображения не поддерживаются.', AVATAR_DIMENSIONS: 'Изображение должно быть не больше 4096 × 4096 пикселей.',
    AVATAR_TOO_LARGE: 'Файл аватара превышает 5 MiB.', AVATAR_BUSY: 'Сервер занят обработкой изображений. Попробуйте позже.',
    INVALID_INPUT: 'Проверьте введённые данные.', CURRENT_PASSWORD_INVALID: 'Текущий пароль указан неверно.', DATABASE_UNAVAILABLE: 'Сервер временно не может сохранить изменение.',
    GAME_ENGINE_UNAVAILABLE: 'Сетевое лобби работает. Начало матча появится после подключения игрового движка.',
    RATE_LIMITED: 'Слишком много запросов. Подождите немного.',
  }
  message.value = messages[code] ?? `Не удалось выполнить запрос: ${code}`
}

async function loadDecks() {
  decksLoading.value = true
  try {
    decks.value = await loadSavedDecks(api)
    await ensureDeckSelected()
  } finally { decksLoading.value = false }
}

function preferredDeckId() {
  let lastPlayed = ''
  try { lastPlayed = localStorage.getItem(`bfw:last-played-deck:${user.value?.id}`) ?? '' } catch { /* Fall back to the first playable deck. */ }
  return playableDecks.value.find(deck => deck.id === lastPlayed)?.id ?? playableDecks.value[0]?.id ?? ''
}

async function ensureDeckSelected() {
  if (!room.value || room.value.status !== 'waiting' || busy.value) return
  const existing = playableDecks.value.find(deck => deck.id === room.value?.myDeckId)
  selectedDeckId.value = existing?.id ?? preferredDeckId()
  if (selectedDeckId.value && (!existing || existing.revision !== room.value.myDeckRevision)) await selectDeck()
}

async function loadRoom() {
  try {
    const currentRoom = await api('/rooms/current') as Room
    if (!acceptRoomView(currentRoom)) return
    if (currentRoom.status === 'playing' && currentRoom.matchId) acceptMatchSnapshot(await api(`/matches/${currentRoom.matchId}/snapshot`))
    else { matchSnapshot.value = null; await ensureDeckSelected() }
  } catch (error) { if (error instanceof Error && error.message !== 'ROOM_NOT_FOUND') throw error; room.value = null; matchSnapshot.value = null }
}

function connectSocket() {
  if (!user.value || closing) return
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${protocol}//${location.host}/ws`)
  socket.value = ws
  ws.onopen = () => { connected.value = false }
  ws.onmessage = event => {
    const packet = JSON.parse(event.data)
    if (packet.type === 'session.ready') ws.send(JSON.stringify({ type: 'session.hello', payload: { protocolVersion: 1 } }))
    else if (packet.type === 'session.hello.ack') {
      connected.value = true
      void (async () => {
        try {
          await loadRoom()
          if (room.value?.status === 'playing' && room.value.matchId) ws.send(JSON.stringify({ type: 'match.subscribe', payload: { matchId: room.value.matchId } }))
          if (pendingCommand.value && room.value?.matchId === pendingCommand.value.payload.matchId && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(pendingCommand.value))
          else if (pendingCommand.value) pendingCommand.value = null
        }
        catch (error) { setError(error) }
      })()
    }
    else if (packet.type === 'room.updated') {
      if (acceptRoomView(packet.payload) && packet.payload.status === 'playing' && packet.payload.participants.every((player: { connected: boolean }) => player.connected) && message.value === 'Соединение игрока потеряно. Сервер ждёт переподключения.') message.value = ''
    } else if (packet.type === 'match.started') message.value = 'Матч запущен.'
    else if (packet.type === 'match.snapshot') acceptMatchSnapshot(packet.payload)
    else if (packet.type === 'match.updated') acceptMatchSnapshot(packet.payload.snapshot)
    else if (packet.type === 'command.ack') {
      if (pendingCommand.value?.payload.action === 'turn.end') endTurnOption.value = 'no_penalty'
      if (pendingCommand.value?.payload.action === 'unit.move') selectedMoveUnitId.value = ''
      if (pendingCommand.value?.payload.action === 'unit.attack') selectedMoveUnitId.value = ''
      if (pendingCommand.value?.payload.action === 'unit.attackPlayer') selectedMoveUnitId.value = ''
      if (pendingCommand.value?.payload.action === 'ability.use') selectedMoveUnitId.value = ''
      if (pendingCommand.value?.payload.action === 'card.play') selectedPlayCardId.value = ''
      if (pendingCommand.value?.payload.action === 'item.equip') selectedPlayCardId.value = ''
      if (pendingCommand.value?.payload.action === 'spell.cast') { selectedPlayCardId.value = ''; selectedSpellCell.value = null; selectedSpellUnitId.value = '' }
      pendingCommand.value = null
    }
    else if (packet.type === 'command.rejected') {
      if (packet.payload.snapshot) acceptMatchSnapshot(packet.payload.snapshot)
      if (pendingCommand.value?.payload.action === 'unit.move') selectedMoveUnitId.value = ''
      if (pendingCommand.value?.payload.action === 'unit.attack') selectedMoveUnitId.value = ''
      if (pendingCommand.value?.payload.action === 'unit.attackPlayer') selectedMoveUnitId.value = ''
      if (pendingCommand.value?.payload.action === 'ability.use') selectedMoveUnitId.value = ''
      if (pendingCommand.value?.payload.action === 'card.play') selectedPlayCardId.value = ''
      if (pendingCommand.value?.payload.action === 'item.equip') selectedPlayCardId.value = ''
      if (pendingCommand.value?.payload.action === 'spell.cast') { selectedPlayCardId.value = ''; selectedSpellCell.value = null; selectedSpellUnitId.value = '' }
      pendingCommand.value = null
      setError(new Error(packet.payload.code))
    }
    else if (packet.type === 'room.closed') {
      room.value = null
      matchSnapshot.value = null
      pendingCommand.value = null
      message.value = 'Комната закрыта.'
    } else if (packet.type === 'match.paused') message.value = 'Соединение игрока потеряно. Сервер ждёт переподключения.'
    else if (packet.type === 'match.ended') message.value = 'Матч завершён: ' + packet.payload.reason
    else if (packet.type === 'command.rejected') setError(new Error(packet.payload.code))
  }
  ws.onclose = () => {
    if (socket.value === ws) socket.value = null
    connected.value = false
    if (!closing && user.value) reconnectTimer = window.setTimeout(connectSocket, 1500)
  }
  ws.onerror = () => { connected.value = false }
}

async function startSession(register: boolean) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    const data = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body: { username: username.value, password: password.value } })
    closing = false
    user.value = data.user    csrfToken.value = data.csrfToken
    password.value = ''
    await Promise.all([loadDecks(), loadRoom()])
    busy.value = false
    await ensureDeckSelected()
    connectSocket()
  } catch (error) { setError(error) }
  finally { busy.value = false }
}

async function refreshAccount() {
  try {
    const data = await api('/me')
    user.value = data.user    csrfToken.value = (await api('/auth/csrf')).csrfToken
    await Promise.all([loadDecks(), loadRoom()])
    connectSocket()
  } catch (error) {
    if (error instanceof Error && error.message !== 'UNAUTHENTICATED') setError(error)
  }
}

async function roomRequest(path: string, method: string, body?: unknown): Promise<boolean> {
  busy.value = true
  message.value = ''
  try {
    const result = await api(path, { method, body })
    if (result) acceptRoomView(result)
    return true
  } catch (error) { setError(error); return false }
  finally { busy.value = false }
}

async function createRoom() {
  if (busy.value || decksLoading.value || !playableDecks.value.length) return
  if (await roomRequest('/rooms', 'POST', {})) await ensureDeckSelected()
}
async function joinRoom() {
  if (busy.value || decksLoading.value || !playableDecks.value.length) return
  if (await roomRequest('/rooms/join', 'POST', { code: joinCode.value })) await ensureDeckSelected()
}
async function selectDeck() {
  if (!room.value || room.value.status !== 'waiting' || busy.value || !playableDecks.value.some(deck => deck.id === selectedDeckId.value)) return
  const currentRoom = room.value
  if (!await roomRequest(`/rooms/${currentRoom.id}/selection`, 'PUT', { deckId: selectedDeckId.value }) && room.value?.id === currentRoom.id) selectedDeckId.value = room.value.myDeckId ?? ''
}
async function setReady(ready: boolean) {
  if (!room.value) return
  await roomRequest(`/rooms/${room.value.id}/ready`, 'PUT', { ready, ...(ready ? { deckRevision: selectedDeck.value?.revision } : {}) })
}
async function startMatch() {
  if (!room.value) return
  await roomRequest(`/rooms/${room.value.id}/start`, 'POST', {})
  if (room.value?.matchId) {
    try { acceptMatchSnapshot(await api(`/matches/${room.value.matchId}/snapshot`)) }
    catch (error) { setError(error) }
  }
}
function concede() {
  if (!room.value?.matchId || !matchSnapshot.value || !socket.value || socket.value.readyState !== WebSocket.OPEN) return
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: matchSnapshot.value.public.version, action: 'match.concede', data: {} } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}
function toggleDiscardCard(instanceId: string) {
  selectedPlayCardId.value = ''
  selectedSpellCell.value = null
  selectedSpellUnitId.value = ''
  if (endTurnOption.value !== 'discard_and_decrease_limit') return
  if (selectedDiscards.value.includes(instanceId)) selectedDiscards.value = selectedDiscards.value.filter(id => id !== instanceId)
  else if (selectedDiscards.value.length < 2) selectedDiscards.value.push(instanceId)
}
function endTurn() {
  const snapshot = matchSnapshot.value
  if (!room.value?.matchId || !snapshot || snapshot.private.pendingChoice || snapshot.public.current !== snapshot.private.seat || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  const played = snapshot.public.players[snapshot.private.seat]?.played
  const data: TurnEndData = played ? {} : endTurnOption.value === 'discard_and_decrease_limit'
    ? { option: endTurnOption.value, discardedCardInstanceIds: [...selectedDiscards.value] }
    : { option: endTurnOption.value }
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'turn.end', data } }
  socket.value.send(JSON.stringify(pendingCommand.value))
  showTurnEnd.value = false
  selectedDiscards.value = []
  selectedPlayCardId.value = ''
  selectedSpellCell.value = null
  selectedMoveUnitId.value = ''
}
function moveUnitTo(row: number, col: number) {
  const snapshot = matchSnapshot.value
  if (!room.value?.matchId || !snapshot || !selectedMoveUnitId.value || snapshot.public.current !== snapshot.private.seat || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'unit.move', data: { unitId: selectedMoveUnitId.value, to: { row, col } } } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}
function attackUnit(targetUnitId: string) {
  const snapshot = matchSnapshot.value
  if (!room.value?.matchId || !snapshot || !selectedMoveUnitId.value || snapshot.public.current !== snapshot.private.seat || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'unit.attack', data: { unitId: selectedMoveUnitId.value, targetUnitId } } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}
function attackPlayer() {
  const snapshot = matchSnapshot.value
  if (!room.value?.matchId || !snapshot || !selectedDirectAttackUnit.value || snapshot.public.current !== snapshot.private.seat || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'unit.attackPlayer', data: { unitId: selectedDirectAttackUnit.value.id } } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}
function useAbility(abilityIndex: number, scoreAdjustment?: -1 | 1) {
  const snapshot = matchSnapshot.value
  const unit = selectedMoveUnitId.value
  const ability = selectedUnitAbilities.value.find(item => item.index === abilityIndex)
  if (!room.value?.matchId || !snapshot || !unit || !ability || (ability.operation === 'adjust-next-score') !== Boolean(scoreAdjustment) || snapshot.public.current !== snapshot.private.seat || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'ability.use', data: { unitId: unit, abilityIndex, ...(scoreAdjustment ? { scoreAdjustment } : {}) } } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}
function selectCardToPlay(instanceId: string) {
  if (ignoreDragClick || showTurnEnd.value || !canInteract.value) return
  const snapshot = matchSnapshot.value
  if (!snapshot || snapshot.private.pendingChoice || snapshot.public.current !== snapshot.private.seat || pendingCommand.value) return
  selectedPlayCardId.value = selectedPlayCardId.value === instanceId ? '' : instanceId
  selectedSpellCell.value = null
  selectedSpellUnitId.value = ''
  selectedMoveUnitId.value = ''
  selectedDiscards.value = []
  playPayment.value = 'mana'
  playWithHorny.value = false
}
function playCardAt(row: number, col: number) {
  const snapshot = matchSnapshot.value
  const card = snapshot?.private.hand.find(item => item.instanceId === selectedPlayCardId.value)
  if (!room.value?.matchId || !snapshot || !card || ![0, 1, 3].includes(card.Type) || snapshot.public.current !== snapshot.private.seat || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  if (card.Type === 1) {
    const target = boardUnitAt(row, col)
    if (!target || target.card.Type !== 0 || target.item || target.flippedTurns) return
    pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'item.equip', data: { cardInstanceId: card.instanceId, targetUnitId: target.id, payment: playPayment.value } } }
    socket.value.send(JSON.stringify(pendingCommand.value))
    return
  }
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'card.play', data: { cardInstanceId: card.instanceId, target: { row, col }, payment: playPayment.value, ...(playWithHorny.value && ['Декстергон', 'V1'].includes(card.Name) ? { horny: true } : {}) } } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}
function takeSavedCard(cardInstanceId: string) {
  const snapshot = matchSnapshot.value
  if (!room.value?.matchId || !snapshot || snapshot.public.status !== 'active' || snapshot.public.current !== snapshot.private.seat || snapshot.private.pendingChoice || !snapshot.private.saved.some(card => card.instanceId === cardInstanceId) || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'card.takeSaved', data: { cardInstanceId } } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}

function castSelectedSpell(target?: SpellCastData['target'], choice?: SpellCastData['choice']) {
  const snapshot = matchSnapshot.value
  const card = selectedPlayCard.value
  if (!room.value?.matchId || !snapshot || !card || !selectedSpellSupported.value || snapshot.public.current !== snapshot.private.seat || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  if (selectedSpellResourceChoice.value ? choice !== 'mana' && choice !== 'energy' : choice !== undefined) return
  const area = spellAreaDamage(card.Description ?? '')
  const lineBuff = spellLineBuff(card.Description ?? '') !== null
  const needsUnitTarget = targetedSpellDamage(card.Description ?? '') !== null || gambaDamageOperation(card.Description ?? '') !== null || selectedSpellDiscordDrama.value || selectedSpellRoseZlo.value || spellLineDamage(card.Description ?? '') !== null || spellBurnsCreature(card.Description ?? '') || spellKillsCreature(card.Description ?? '') || targetedSpellFlipTurns(card.Description ?? '') !== null || flexibleHealOrStunEffect(card.Description ?? '') !== null || spellBuffToEndTurnDeath(card.Description ?? '') !== null || grantsRageUntilOwnerEnd(card.Description ?? '') || spellMovesTargetToSocket(card.Description ?? '') !== null
  const spellTarget = target ?? (area || lineBuff ? selectedSpellCell.value : selectedSpellUnitId.value ? { unitId: selectedSpellUnitId.value } : undefined)
  if ((area || lineBuff || needsUnitTarget) && !spellTarget) return
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'spell.cast', data: { cardInstanceId: card.instanceId, payment: playPayment.value, ...(spellTarget ? { target: spellTarget } : {}), ...(choice ? { choice } : {}), ...(selectedSpellDiscordDrama.value ? { manaAmount: discordDramaMana.value } : {}), ...(selectedSpellRoseZlo.value ? { healthAmount: roseZloHealth.value } : {}) } } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}
function resolveChoice(choiceId: string, unitId: string | string[] | { row: number; col: number } | { player: 'self' | 'opponent' } | { choice: 'draw' | 'limit' | 'mana' | 'energy' | 'viskas-draw' | 'viskas-discard' | 'swarm-draw' | 'swarm-mana' | 'keep' | 'discard' } | { choice: 'librarian-cost'; cost: 1 | 2 | 4 } | { choice: 'librarian-pile'; pile: 'deck' | 'discard' } | { tokenClass: number }) {
  const snapshot = matchSnapshot.value
  if (!room.value?.matchId || !snapshot || snapshot.private.pendingChoice?.id !== choiceId || !socket.value || socket.value.readyState !== WebSocket.OPEN || pendingCommand.value) return
  const selection = Array.isArray(unitId) ? { unitIds: unitId } : typeof unitId === 'string' ? { unitId } : 'player' in unitId || 'choice' in unitId || 'tokenClass' in unitId ? unitId : { cell: unitId }
  pendingCommand.value = { type: 'game.command', payload: { matchId: room.value.matchId, commandId: crypto.randomUUID(), expectedVersion: snapshot.public.version, action: 'choice.resolve', data: { choiceId, selection } } }
  socket.value.send(JSON.stringify(pendingCommand.value))
}
function toggleChoiceTarget(choiceId: string, unitId: string) {
  const choice = matchSnapshot.value?.private.pendingChoice
  if (!choice || choice.id !== choiceId || !choice.count || pendingCommand.value) return
  const unitIds = selectedChoiceTargets.value.choiceId === choiceId ? [...selectedChoiceTargets.value.unitIds] : []
  const index = unitIds.indexOf(unitId)
  if (index >= 0) unitIds.splice(index, 1)
  else if (unitIds.length < choice.count) unitIds.push(unitId)
  selectedChoiceTargets.value = { choiceId, unitIds }
}
function chooseMoveUnit(unitId: string) {
  const snapshot = matchSnapshot.value
  if (!snapshot || selectedPlayCardId.value || snapshot.public.current !== snapshot.private.seat || pendingCommand.value) return
  selectedMoveUnitId.value = selectedMoveUnitId.value === unitId ? '' : unitId
}
function boardUnitAt(row: number, col: number) {
  return matchSnapshot.value?.public.board.find(unit => unit.row === row && unit.col === col)
}
function cardArt(name: string) {
  return '/cards/' + encodeURIComponent(name).replaceAll('%40', '@') + '.png'
}
function wheatAt(row: number, col: number) {
  return matchSnapshot.value?.public.wheatTokens.filter(token => token.row === row && token.col === col).length ?? 0
}
function boardCellDisabled(row: number, col: number) {
  const snapshot = matchSnapshot.value
  if (!snapshot || snapshot.public.current !== snapshot.private.seat || !connected.value || pendingCommand.value || snapshot.private.pendingChoice) return true
  const unit = boardUnitAt(row, col)
  if (selectedPlayCard.value) {
    if (selectedPlayCard.value.Type === 2) {
      if (spellAreaDamage(selectedPlayCard.value.Description ?? '')) return false
      if (spellLineBuff(selectedPlayCard.value.Description ?? '') !== null) return false
      const moveMode = spellMovesTargetToSocket(selectedPlayCard.value.Description ?? '')
      if (moveMode) return !unit || Boolean(unit.flippedTurns) || (moveMode === 'opponent' ? unit.card.Type !== 0 : ![0, 3].includes(unit.card.Type) || unit.card.Type === 3 && (unit.row === 0 || unit.row === 4))
      if (selectedSpellGamba.value) return !unit || ![0, 3].includes(unit.card.Type) || Boolean(unit.flippedTurns)
      if (selectedSpellDiscordDrama.value) return !unit || ![0, 3].includes(unit.card.Type) || Boolean(unit.flippedTurns)
      if (selectedSpellRoseZlo.value) return !unit || ![0, 3].includes(unit.card.Type) || Boolean(unit.flippedTurns)
      if (spellLineDamage(selectedPlayCard.value.Description ?? '') !== null) return !unit || Boolean(unit.flippedTurns)
      if (spellBurnsCreature(selectedPlayCard.value.Description ?? '')) return !unit || unit.card.Type !== 0 || Boolean(unit.flippedTurns)
      if (spellKillsCreature(selectedPlayCard.value.Description ?? '')) return !unit || unit.card.Type !== 0 || Boolean(unit.flippedTurns)
      if (targetedSpellFlipTurns(selectedPlayCard.value.Description ?? '') !== null) return !unit || unit.card.Type !== 0 || Boolean(unit.flippedTurns)
      if (flexibleHealOrStunEffect(selectedPlayCard.value.Description ?? '')) return !unit || unit.card.Type !== 0 || Boolean(unit.flippedTurns)
      if (spellBuffToEndTurnDeath(selectedPlayCard.value.Description ?? '')) return !unit || unit.owner !== snapshot.private.seat || unit.card.Type !== 0 || Boolean(unit.flippedTurns)
      if (grantsRageUntilOwnerEnd(selectedPlayCard.value.Description ?? '')) return !unit || unit.card.Type !== 0 || Boolean(unit.flippedTurns)
      if (spellDestroysBuilding(selectedPlayCard.value.Description ?? '')) return !unit || unit.card.Type !== 3 || Boolean(unit.flippedTurns)
      if (spellTargetTransfer(selectedPlayCard.value.Description ?? '')) return !unit || ![0, 3].includes(unit.card.Type) || Boolean(unit.flippedTurns)
      const damage = targetedSpellDamage(selectedPlayCard.value.Description ?? '')
      return damage ? !unit || ![0, 3].includes(unit.card.Type) || !targetMatchesKind(unit.card.Type, damage.targetType) || Boolean(unit.flippedTurns) : true
    }
    if (selectedPlayCard.value.Type === 1) return !unit || unit.card.Type !== 0 || Boolean(unit.item || unit.flippedTurns)
    if (snapshot.public.players[snapshot.private.seat]?.played) return true
    if (selectedPlayCard.value.Type === 0) return row !== (snapshot.private.seat === 0 ? 4 : 0) || Boolean(unit && !creaturePushLine(snapshot.public.board, snapshot.private.seat, row, col, snapshot.public.movementLock))
    return row === 0 || row === 4 || Boolean(unit)
  }
  if (unit?.owner === snapshot.private.seat && !selectedMoveUnitId.value) return false
  const selected = snapshot.public.board.find(unit => unit.id === selectedMoveUnitId.value)
  return !selected || !unitDropMode(selected, row, col)
}
function clickBoardCell(row: number, col: number) {
  if (ignoreDragClick || !canInteract.value) return
  const unit = boardUnitAt(row, col)
  if (selectedPlayCard.value) {
    if (selectedPlayCard.value.Type === 2 && (spellAreaDamage(selectedPlayCard.value.Description ?? '') || spellLineBuff(selectedPlayCard.value.Description ?? '') !== null)) selectedSpellCell.value = { row, col }
    else if (selectedPlayCard.value.Type === 2 && unit && (selectedSpellMove.value && !unit.flippedTurns && (selectedSpellMove.value === 'opponent' ? unit.card.Type === 0 : [0, 3].includes(unit.card.Type) && (unit.card.Type !== 3 || unit.row > 0 && unit.row < 4)) || (selectedSpellGamba.value || selectedSpellDiscordDrama.value || selectedSpellRoseZlo.value) && [0, 3].includes(unit.card.Type) && !unit.flippedTurns || selectedSpellLineDamage.value && !unit.flippedTurns || selectedSpellBurnCreature.value && unit.card.Type === 0 && !unit.flippedTurns || selectedSpellKillCreature.value && unit.card.Type === 0 && !unit.flippedTurns || selectedSpellFlip.value !== null && unit.card.Type === 0 && !unit.flippedTurns || selectedSpellHealOrStun.value && unit.card.Type === 0 && !unit.flippedTurns || selectedSpellTemporaryBuff.value && unit.owner === matchSnapshot.value?.private.seat && unit.card.Type === 0 && !unit.flippedTurns || selectedSpellRage.value && unit.card.Type === 0 && !unit.flippedTurns || selectedSpellBuilding.value && unit.card.Type === 3 && !unit.flippedTurns || selectedSpellTransfer.value && [0, 3].includes(unit.card.Type) && !unit.flippedTurns || selectedSpellDamage.value && [0, 3].includes(unit.card.Type) && targetMatchesKind(unit.card.Type, selectedSpellDamage.value.targetType) && !unit.flippedTurns)) selectedSpellUnitId.value = unit.id
    else if (selectedPlayCard.value.Type !== 2) playCardAt(row, col)
    return
  }
  if (!unit) { moveUnitTo(row, col); return }
  if (unit.owner === matchSnapshot.value?.private.seat) chooseMoveUnit(unit.id)
  else attackUnit(unit.id)
}
async function leaveRoom() {
  if (!room.value || !await roomRequest(`/rooms/${room.value.id}/leave`, 'POST', {})) return
  room.value = null
  matchSnapshot.value = null
  pendingCommand.value = null
}

async function copyRoomCode() {
  if (room.value) await navigator.clipboard?.writeText(room.value.code)
}

onMounted(refreshAccount)
onUnmounted(() => { closing = true; window.clearTimeout(reconnectTimer); socket.value?.close() })
</script>

<template>
  <main :class="matchSnapshot ? 'online-game-root app-shell' : 'online-shell'">
    <button v-if="!matchSnapshot" class="online-back" @click="emit('back')">← К режимам</button>
    <header v-if="!matchSnapshot" class="online-heading">
      <p class="online-kicker">BFW · СЕТЕВОЕ ЛОББИ</p>
      <h1>Играйте <em>вместе</em></h1>
      <p>Войдите в аккаунт, выберите сохранённую колоду и пригласите второго игрока.</p>
    </header>

    <form v-if="!user" class="online-panel auth-panel" @submit.prevent="startSession(registering)">
      <div class="panel-title"><span>01</span><h2>{{ registering ? 'Создать аккаунт' : 'Войти в аккаунт' }}</h2></div>
      <label>Логин<input v-model="username" name="username" autocomplete="username" minlength="3" maxlength="24" required placeholder="player_1"></label>
      <label>Пароль<input v-model="password" name="password" :autocomplete="registering ? 'new-password' : 'current-password'" minlength="12" type="password" required placeholder="Не менее 12 символов"></label>
      <button class="online-primary" :disabled="busy">{{ busy ? 'Подождите…' : registering ? 'Зарегистрироваться' : 'Войти' }}</button>
      <button class="online-link" type="button" @click="registering=!registering;message=''">{{ registering ? 'Уже есть аккаунт? Войти' : 'Нужен аккаунт? Зарегистрироваться' }}</button>
    </form>

    <template v-else>
      <section v-if="!matchSnapshot" class="account-bar"><slot name="account-control" :user="user" :connected="connected"></slot></section>
      <section v-if="!room" class="online-panel room-entry">
        <div class="panel-title"><span>02</span><h2>Найдите соперника</h2></div>
        <p v-if="decksLoading" class="empty-decks" role="status">Загрузка колод…</p><p v-else-if="!playableDecks.length" class="empty-decks" role="status">Нет готовой колоды. Создайте хотя бы одну колоду по правилам в редакторе на главной странице.</p>
        <div class="room-actions"><button class="online-primary" :disabled="busy || !connected || decksLoading || !playableDecks.length" @click="createRoom">Создать комнату</button><form class="join-form" @submit.prevent="joinRoom"><label for="room-code">Код приглашения</label><div><input id="room-code" v-model="joinCode" minlength="8" maxlength="8" autocomplete="off" placeholder="ABCDEFGH" required><button class="online-secondary" :disabled="busy || !connected || decksLoading || !playableDecks.length">Войти</button></div></form></div>
      </section>
      <section v-else-if="room.status!=='playing'" class="online-panel room-panel">
        <div class="panel-title"><span>02</span><div><h2>Комната {{ room.code }}</h2><small>Отправьте этот код сопернику</small></div><button class="copy-code" @click="copyRoomCode">Копировать</button></div>
        <ol class="participants"><li v-for="player in room.participants" :key="player.userId"><span class="participant-dot" :class="{online:player.connected}"></span><div><strong>{{ player.displayName }}</strong><small>@{{ player.username }}</small></div><em>{{ player.ready ? 'Готов' : 'Ожидает' }}</em></li><li v-if="room.participants.length<2" class="vacant">Ждём второго игрока</li></ol>
        <fieldset v-if="room.status==='waiting'" class="deck-select">
          <legend>Ваша колода</legend>
          <p v-if="decksLoading" class="empty-decks" role="status">Загрузка колод…</p>
          <p v-else-if="!playableDecks.length" class="empty-decks" role="status">Для игры нужна хотя бы одна колода, собранная по правилам. Создайте её в редакторе колод на главной странице.</p>
          <div v-if="!decksLoading" class="deck-library-grid online-deck-grid">
            <label v-for="deck in decks" :key="deck.id" class="saved-deck-tile online-deck-tile" :class="{selected:selectedDeckId===deck.id,unplayable:!deck.playable}">
              <input v-model="selectedDeckId" type="radio" name="online-deck" :value="deck.id" :aria-label="'Колода '+deck.name" :disabled="busy || !connected || !deck.playable" @change="selectDeck">
              <span class="card-stack" aria-hidden="true"><img v-for="(card,index) in deck.cards.slice(0,3)" :key="index" :src="cardArt(card.Name)" alt="" loading="lazy" @error="($event.target as HTMLImageElement).src='/card_back.png'"></span>
              <strong class="deck-radio-title">{{ deck.name }}</strong><span class="deck-radio-meta">{{ deck.cards.length }} карт</span>
              <span class="deck-radio-status">{{ !deck.playable ? 'Колода не готова к игре' : selectedDeckId===deck.id ? 'Выбрана' : 'Выбрать колоду' }}</span>
            </label>
          </div>
        </fieldset>
        <p v-if="room.myDeckId" class="selected-deck">Выбрана колода: {{ selectedDeck?.name ?? room.myDeckId }} · версия {{ room.myDeckRevision }}</p>
        <div class="room-footer"><button class="online-link" @click="leaveRoom">Покинуть комнату</button><div v-if="room.status==='waiting'" class="room-primary-actions"><button class="online-secondary" :disabled="busy || decksLoading || !selectedDeck?.playable || !room.myDeckId || selectedDeck.revision!==room.myDeckRevision" @click="setReady(!room.participants.find(player=>player.userId===user?.id)?.ready)">{{ room.participants.find(player=>player.userId===user?.id)?.ready ? 'Снять готовность' : 'Готов' }}</button><button v-if="room.ownerUserId===user?.id" class="online-primary" :disabled="busy || !room.canStart" @click="startMatch">Начать партию</button></div></div>
      </section>
      <section v-if="room?.status==='playing'" class="game online-match-panel" aria-live="polite" @pointerover.capture="inspectCard" @pointerout.capture="leaveInspectedCard" @focusin.capture="inspectCard" @focusout.capture="leaveInspectedCard">
        <aside v-if="matchSnapshot" class="game-sidebar" aria-label="Раунд и ресурсы"><header v-if="matchSnapshot" class="game-header"><div class="round"><span>РАУНД</span><b>{{ matchSnapshot.public.round }}</b></div></header>
        <div v-if="matchSnapshot" class="resources"><span>✦ Мана <b>{{ matchSnapshot.public.players[matchSnapshot.private.seat]?.mana }}</b></span><span>⚡ Энергия <b>{{ matchSnapshot.public.players[matchSnapshot.private.seat]?.energy }}</b></span><span>Карт в руке <b>{{ matchSnapshot.private.hand.length }} / {{ matchSnapshot.public.players[matchSnapshot.private.seat]?.limit }}</b></span><span v-if="matchSnapshot.private.nextGambaBonus">Гамба +{{ matchSnapshot.private.nextGambaBonus }}</span><span v-if="matchSnapshot.private.nextBurnToSave">Следующая сжигаемая карта сохранится</span></div></aside>
        <div v-if="matchSnapshot?.private.pendingChoice" class="turn-warning-backdrop"><section class="online-choice turn-warning" role="dialog" aria-modal="true" aria-labelledby="choice-title"><h3 id="choice-title">Выбор эффекта «{{ matchSnapshot.private.pendingChoice.sourceCardName }}»</h3><p v-if="matchSnapshot.private.pendingChoice.kind==='swarm-reward'">После гибели существа выберите 1 ману или карту.</p><p v-if="matchSnapshot.private.pendingChoice.kind==='indigolit-heal'">Выберите карту или игрока для лечения на 1 здоровье; осталось применений: {{ matchSnapshot.private.pendingChoice.remaining }}.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='heal-creature'">{{ matchSnapshot.private.pendingChoice.amount ? 'Выберите карту для лечения на '+matchSnapshot.private.pendingChoice.amount+' здоровья.' : 'Выберите существо для полного восстановления здоровья.' }}</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='paradise-target'">Выберите своё живое существо, которому уменьшить стоимость движения на 1.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-take-item'">Выберите существо, у которого нужно забрать предмет.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-destroy-building'">Выберите здание для уничтожения.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-stun-creature'">Выберите существо для оглушения на {{ matchSnapshot.private.pendingChoice.turns }} хода.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-damage-target'">{{ matchSnapshot.private.pendingChoice.roll!==undefined ? 'Гамба '+matchSnapshot.private.pendingChoice.roll+'. Выберите существо для получения '+matchSnapshot.private.pendingChoice.amount+' урона.' : 'Выберите карту для получения '+matchSnapshot.private.pendingChoice.amount+' урона.' }}</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-type-token' && matchSnapshot.private.pendingChoice.stage==='target'">Выберите существо без белых жетонов типажа.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-type-token' && matchSnapshot.private.pendingChoice.stage==='token'">Выберите типаж для жетона. Осталось: {{ matchSnapshot.private.pendingChoice.remaining }}.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-sacrifice-ally-heal'">Выберите союзное существо, которое уничтожить, чтобы восстановить {{ matchSnapshot.private.pendingChoice.amount }} здоровья.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='start-turn-sent-croix'">{{ matchSnapshot.private.pendingChoice.stage==='card' ? 'Выберите самое дешёвое существо из руки.' : 'Выберите свободный соседний сокет для бесплатного розыгрыша.' }}</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='start-turn-burn'">Выберите карты из руки для сжигания.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='start-turn-weakest-burn'">Выберите одно из существ с наименьшим здоровьем для сжигания «Дедруби».</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='start-turn-shield'">Выберите незамороженное существо без щита в соседнем сокете.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='hand-limit-discard'">Лимит руки превышен. Выберите ровно {{ matchSnapshot.private.pendingChoice.count }} карт для сброса, чтобы начать ход.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-discard-hand'">Можно сбросить до {{ matchSnapshot.private.pendingChoice.count }} карт из руки или оставить все.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-search-pile'">{{ matchSnapshot.private.pendingChoice.pile==='burned' ? 'Выберите сожжённую карту для возвращения в руку.' : 'Выберите карту из колоды стоимостью от '+matchSnapshot.private.pendingChoice.minimumCost+'.' }}</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='death-burn-flipped'">Выберите перевёрнутую карту, чтобы сжечь её.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='death-weaken-target'">«Ёжик»: выберите цель для 1 урона и −1 атаки.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='death-intivi'">«ИНТИВИ» взял предмет «{{ matchSnapshot.private.pendingChoice.cardName }}» из колоды. Оставить его в руке или сбросить?</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-save-hand'">Выберите карту из руки, чтобы сберечь её.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-dodep'">{{ matchSnapshot.private.pendingChoice.stage==='burn' ? 'Выберите карту из руки для сжигания; затем гамба даст выбор ресурса.' : 'Гамба: '+matchSnapshot.private.pendingChoice.amount+'. Выберите ресурс для получения.' }}</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-conveyor'">{{ matchSnapshot.private.pendingChoice.stage==='discard' ? 'Выберите карту из руки для сброса.' : matchSnapshot.private.pendingChoice.stage==='burn' ? 'Выберите карту из руки для сжигания.' : 'Выберите карту из руки для сбережения.' }}</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-librarian'">{{ matchSnapshot.private.pendingChoice.stage==='cost' ? 'Выберите стоимость поиска и редкость карты.' : matchSnapshot.private.pendingChoice.stage==='pile' ? 'Выберите колоду или сброс.' : 'Выберите карту для Библиотекаря.' }}</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-draw-or-limit'">Выберите: взять карту или увеличить лимит руки до следующего хода.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-sacrifice-building'">Выберите своё здание, которое уничтожит «Биби» ради +{{ matchSnapshot.private.pendingChoice.amount }} атаки до конца хода.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-heal-creature'">Выберите существо для лечения на {{ matchSnapshot.private.pendingChoice.amount }} здоровья.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-damage-target'">Выберите карту для получения {{ matchSnapshot.private.pendingChoice.amount }} урона.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-put-target-on-deck'">Выберите существо, чтобы отправить его наверх колоды владельца.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-damage-targets'">Выберите {{ matchSnapshot.private.pendingChoice.count }} разных целей для получения {{ matchSnapshot.private.pendingChoice.amount }} урона.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-heal-targets'">Выберите {{ matchSnapshot.private.pendingChoice.count }} разных целей для лечения на {{ matchSnapshot.private.pendingChoice.amount }} здоровья.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-move-front'">Выберите существо для переноса вперёд.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-move-self'">Выберите свободную клетку для переноса.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-move-target'">Выберите незанятый сокет{{ matchSnapshot.private.pendingChoice.mode==='opponent' ? ' на стартовом ряду противника' : matchSnapshot.private.pendingChoice.mode==='adjacent' ? ' на соседний сокет' : '' }}.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='ability-swap-self'">Выберите существо для рокировки местами.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-swap-creatures'">Выберите двух существ для обмена местами.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-swap-stats'">Выберите двух существ для обмена параметрами и жетонами.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-destroy-creatures'">Выберите {{ matchSnapshot.private.pendingChoice.count }} существ для уничтожения.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='wismuth-discard'">Выберите предмет или здание, которое сбросить; второе останется в руке.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-take-enemy-building'">Выберите вражеское здание, чтобы получить над ним контроль.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-return-creature'">Выберите существо, которое вернуть в руку его владельца.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-save-allied'">Выберите союзную карту, чтобы отправить её в сбережения.</p><p v-else-if="matchSnapshot.private.pendingChoice.kind==='entry-save-flipped'">Выберите перевёрнутую карту, чтобы сберечь её.</p><p v-else>{{ pendingChoicePrompt(matchSnapshot.private.pendingChoice) }}</p><div v-if="matchSnapshot.private.pendingChoice.kind==='ability-draw-or-limit'" class="online-choice-options"><button class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, { choice: 'draw' })">Взять карту</button><button class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, { choice: 'limit' })">Увеличить лимит руки</button></div><div v-else-if="matchSnapshot.private.pendingChoice.kind==='spell-dodep' && matchSnapshot.private.pendingChoice.stage==='resource'" class="online-choice-options"><button class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, { choice: 'mana' })">Получить {{ matchSnapshot.private.pendingChoice.amount }} маны</button><button class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, { choice: 'energy' })">Получить {{ matchSnapshot.private.pendingChoice.amount }} энергии</button></div><div v-else-if="matchSnapshot.private.pendingChoice.kind==='indigolit-heal' || matchSnapshot.private.pendingChoice.kind==='swarm-reward' || matchSnapshot.private.pendingChoice.kind==='death-intivi'" class="online-choice-options"><button v-for="choice in matchSnapshot.private.pendingChoice.choices" :key="choice.label" class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, choice.value)">{{ choice.label }}</button><button v-for="option in matchSnapshot.private.pendingChoice.options" :key="option.unitId" class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, option.unitId)">{{ option.name }}</button></div><div v-else-if="(matchSnapshot.private.pendingChoice.kind==='ability-librarian' && matchSnapshot.private.pendingChoice.stage!=='card' || matchSnapshot.private.pendingChoice.kind==='viskas-choice' && matchSnapshot.private.pendingChoice.stage==='option' || matchSnapshot.private.pendingChoice.kind==='entry-type-token' && matchSnapshot.private.pendingChoice.stage==='token')" class="online-choice-options"><button v-for="choice in matchSnapshot.private.pendingChoice.choices" :key="JSON.stringify(choice.value)" class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, choice.value)">{{ 'tokenClass' in choice.value ? classNames[choice.value.tokenClass] : choice.label }}</button></div><template v-else-if="matchSnapshot.private.pendingChoice.count"><ul><li v-for="option in matchSnapshot.private.pendingChoice.options" :key="option.unitId"><button class="online-secondary" :aria-pressed="selectedChoiceTargets.choiceId===matchSnapshot.private.pendingChoice.id && selectedChoiceTargets.unitIds.includes(option.unitId)" :disabled="!connected || Boolean(pendingCommand)" @click="toggleChoiceTarget(matchSnapshot!.private.pendingChoice!.id, option.unitId)">{{ selectedChoiceTargets.choiceId===matchSnapshot.private.pendingChoice.id && selectedChoiceTargets.unitIds.includes(option.unitId) ? '✓ ' : '' }}{{ option.name }}</button></li></ul><p aria-live="polite">Выбрано {{ matchSnapshot.private.pendingChoice.kind==='start-turn-burn' || matchSnapshot.private.pendingChoice.kind==='spell-discard-hand' || matchSnapshot.private.pendingChoice.kind==='hand-limit-discard' || matchSnapshot.private.pendingChoice.kind==='spell-save-hand' || matchSnapshot.private.pendingChoice.kind==='death-save-deck-cards' ? 'карт' : 'целей' }}: {{ selectedChoiceTargets.choiceId===matchSnapshot.private.pendingChoice.id ? selectedChoiceTargets.unitIds.length : 0 }} / {{ matchSnapshot.private.pendingChoice.count }}</p><button class="online-primary" :disabled="!connected || Boolean(pendingCommand) || selectedChoiceTargets.choiceId!==matchSnapshot.private.pendingChoice.id || (matchSnapshot.private.pendingChoice.kind!=='spell-discard-hand' && matchSnapshot.private.pendingChoice.kind!=='death-save-deck-cards' && selectedChoiceTargets.unitIds.length!==matchSnapshot.private.pendingChoice.count)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, selectedChoiceTargets.unitIds)">{{ (matchSnapshot.private.pendingChoice.kind==='spell-discard-hand' || matchSnapshot.private.pendingChoice.kind==='hand-limit-discard') ? 'Сбросить выбранные карты' : matchSnapshot.private.pendingChoice.kind==='start-turn-burn' ? 'Сжечь выбранные карты' : matchSnapshot.private.pendingChoice.kind==='spell-save-hand' ? 'Сберечь выбранную карту' : matchSnapshot.private.pendingChoice.kind==='death-save-deck-cards' ? 'Сберечь выбранные карты' : matchSnapshot.private.pendingChoice.kind==='spell-destroy-creatures' ? 'Уничтожить выбранных существ' : matchSnapshot.private.pendingChoice.kind==='spell-swap-stats' ? 'Обменять параметры' : 'Применить выбранные цели' }}</button><button v-if="matchSnapshot.private.pendingChoice.kind==='spell-discard-hand' || matchSnapshot.private.pendingChoice.kind==='death-save-deck-cards'" class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, [])">{{ matchSnapshot.private.pendingChoice.kind==='death-save-deck-cards' ? 'Ничего не сберегать' : 'Оставить все' }}</button></template><ul v-else><li v-for="option in matchSnapshot.private.pendingChoice.options" :key="option.unitId"><button class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, option.unitId)">{{ option.name }}</button></li></ul><button v-if="matchSnapshot.private.pendingChoice.kind==='death-weaken-target' && matchSnapshot.private.pendingChoice.playerTarget" class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, { player: 'opponent' })">Нанести 1 урон сопернику</button><button v-if="matchSnapshot.private.pendingChoice.kind==='ability-damage-target' && matchSnapshot.private.pendingChoice.playerTarget" class="online-secondary" :disabled="!connected || Boolean(pendingCommand)" @click="resolveChoice(matchSnapshot!.private.pendingChoice!.id, { player: 'opponent' })">Нанести {{ matchSnapshot.private.pendingChoice.amount }} урона здоровью соперника</button></section></div>

        <div v-if="matchSnapshot" class="hand-wrap" :class="{'warning-discard-mode':showTurnEnd && endTurnOption==='discard_and_decrease_limit'}" :style="{'--hand-count':matchSnapshot.private.hand.length}">
          <div class="hand-title"><div><span>{{ myTurn ? 'РУКА' : 'ХОД СОПЕРНИКА' }}</span><b>{{ matchSnapshot.private.hand.length }} / {{ matchSnapshot.public.players[matchSnapshot.private.seat]?.limit }}</b></div><button class="end-turn" :disabled="!canInteract" @click="requestEndTurn">{{ myTurn ? 'Завершить ход' : 'Ход соперника' }}</button></div>
          <div class="match-hand hand"><button v-for="(card,index) in matchSnapshot.private.hand" :key="card.instanceId" class="hand-card" :data-card-instance="card.instanceId" :style="{'--hand-order':index}" :class="{ selected:selectedDiscards.includes(card.instanceId) || selectedPlayCardId===card.instanceId, 'dragging-source':dragging && drag?.kind==='hand' && drag.id===card.instanceId }" :disabled="!canInteract || !showTurnEnd && matchSnapshot.public.players[matchSnapshot.private.seat]?.played" :aria-pressed="selectedDiscards.includes(card.instanceId) || selectedPlayCardId===card.instanceId" @pointerdown="beginDrag($event,'hand',card.instanceId)" @dragstart.prevent @click="!ignoreDragClick && (showTurnEnd && endTurnOption==='discard_and_decrease_limit' ? toggleDiscardCard(card.instanceId) : selectCardToPlay(card.instanceId))"><img :src="cardArt(card.Name)" :alt="card.Name" draggable="false"></button></div>
        </div>
        <details v-if="matchSnapshot?.private.saved.length" class="online-choice saved-pile"><summary>Сбережения · {{ matchSnapshot.private.saved.length }}</summary><ul><li v-for="card in matchSnapshot.private.saved" :key="card.instanceId"><button class="online-secondary" :disabled="!connected || Boolean(pendingCommand) || Boolean(matchSnapshot.private.pendingChoice) || matchSnapshot.public.status!=='active' || matchSnapshot.public.current!==matchSnapshot.private.seat" @click="takeSavedCard(card.instanceId)">Взять «{{ card.Name }}» в руку</button></li></ul></details>
        <aside v-if="canInteract && (selectedPlayCard || selectedMoveUnitId)" v-show="!dragging" class="online-action-panel"><button class="online-link" @click="selectedPlayCardId='';selectedMoveUnitId=''">Отмена</button>
        <fieldset v-if="selectedPlayCard && selectedPlayCard.Type!==0 && bloodEmpireActive" class="play-payment"><legend>Оплата карты</legend><label><input v-model="playPayment" type="radio" value="mana"> Мана</label><label><input v-model="playPayment" type="radio" value="health"> Здоровье</label></fieldset>
        <label v-if="selectedPlayCard?.Name==='Декстергон'" class="play-horny"><input v-model="playWithHorny" type="checkbox"> Заплатить 6 здоровья, чтобы дать щит существам слева и справа</label>
        <label v-if="selectedPlayCard?.Name==='V1'" class="play-horny"><input v-model="playWithHorny" type="checkbox"> Заплатить 10 здоровья, чтобы коронный эффект работал с досягаемостью</label>
        <p v-if="selectedPlayCard?.Type===2 && spellAreaDamage(selectedPlayCard.Description ?? '')" aria-live="polite">{{ selectedSpellCell ? `Центр области: ${String.fromCharCode(1040+selectedSpellCell.row)}${selectedSpellCell.col+1}` : 'Выберите клетку поля как центр области.' }}</p>
        <p v-if="selectedSpellLineBuff" aria-live="polite">{{ selectedSpellCell ? `Линия через клетку ${String.fromCharCode(1040+selectedSpellCell.row)}${selectedSpellCell.col+1}` : 'Выберите клетку, чтобы усилить карты в её ряду и столбце.' }}</p>
        <p v-if="selectedSpellLineDamage && !selectedSpellUnitId" aria-live="polite">Выберите незамороженную карту: заклинание заденет существ в её ряду и столбце.</p>
        <p v-if="selectedSpellBurnCreature && !selectedSpellUnitId" aria-live="polite">Выберите незамороженное существо, которое нужно сжечь.</p>
        <p v-if="selectedSpellKillCreature && !selectedSpellUnitId" aria-live="polite">Выберите неперевёрнутое существо для убийства.</p>
        <p v-if="selectedSpellFlip !== null && !selectedSpellUnitId" aria-live="polite">Выберите неперевёрнутое существо для переворота.</p>
        <p v-if="selectedSpellHealOrStun && !selectedSpellUnitId" aria-live="polite">Выберите союзное существо для лечения или вражеское для оглушения.</p>
        <p v-if="selectedSpellTemporaryBuff && !selectedSpellUnitId" aria-live="polite">Выберите своё неперевёрнутое существо; оно погибнет в конце вашего хода.</p>
        <p v-if="selectedSpellRage && !selectedSpellUnitId" aria-live="polite">Выберите неперевёрнутое существо; оно получит ярость и погибнет в конце хода своего владельца.</p>
        <p v-if="(selectedSpellDamage || selectedSpellBuilding || selectedSpellTransfer || selectedSpellLineDamage || selectedSpellBurnCreature || selectedSpellKillCreature || selectedSpellFlip !== null || selectedSpellHealOrStun || selectedSpellTemporaryBuff || selectedSpellRage || selectedSpellDiscordDrama) && selectedSpellUnitId" aria-live="polite">Цель: {{ matchSnapshot?.public.board.find(unit=>unit.id===selectedSpellUnitId)?.card.Name }}</p>
        <p v-if="selectedSpellBuilding && !selectedSpellUnitId" aria-live="polite">Выберите здание на поле, затем примените заклинание.</p>
        <p v-if="selectedSpellTransfer && !selectedSpellUnitId" aria-live="polite">Выберите незамороженное существо или здание на поле.</p>
        <label v-if="selectedSpellDiscordDrama" class="play-payment">Маны потратить: <input v-model.number="discordDramaMana" type="number" min="0" :max="matchSnapshot?.public.players[matchSnapshot.private.seat]?.mana ?? 0" step="1" aria-label="Количество маны для Дискорд драмы"></label>
        <label v-if="selectedSpellRoseZlo" class="play-payment">Здоровья потратить: <input v-model.number="roseZloHealth" type="number" min="0" :max="Math.max(0, (matchSnapshot?.public.players[matchSnapshot.private.seat]?.health ?? 1) - 1)" step="1" aria-label="Количество здоровья для Розы зло"></label>
        <button v-if="selectedSpellResourceChoice" class="online-secondary" :disabled="!selectedSpellSupported || matchSnapshot?.public.current!==matchSnapshot?.private.seat || !connected || Boolean(pendingCommand)" @click="() => castSelectedSpell(undefined,'mana')">Получить до 2 маны, забрав её у противника</button>
        <button v-if="selectedSpellResourceChoice" class="online-secondary" :disabled="!selectedSpellSupported || matchSnapshot?.public.current!==matchSnapshot?.private.seat || !connected || Boolean(pendingCommand)" @click="() => castSelectedSpell(undefined,'energy')">Получить до 4 энергии, забрав её у противника</button>
        <button v-if="selectedPlayCard?.Type===2 && !selectedSpellResourceChoice" class="online-secondary" :disabled="!selectedSpellSupported || Boolean((spellAreaDamage(selectedPlayCard.Description ?? '') || selectedSpellLineBuff) && !selectedSpellCell) || Boolean((selectedSpellDamage || selectedSpellBuilding || selectedSpellTransfer || selectedSpellLineDamage || selectedSpellBurnCreature || selectedSpellKillCreature || selectedSpellFlip !== null || selectedSpellHealOrStun || selectedSpellTemporaryBuff || selectedSpellRage || selectedSpellMove || selectedSpellGamba || selectedSpellDiscordDrama || selectedSpellRoseZlo) && !selectedSpellUnitId) || Boolean(selectedSpellMove && !selectedSpellMoveCells.length) || Boolean(selectedSpellDiscordDrama && discordDramaMana > (matchSnapshot?.public.players[matchSnapshot.private.seat]?.mana ?? 0)) || Boolean(selectedSpellRoseZlo && roseZloHealth >= (matchSnapshot?.public.players[matchSnapshot.private.seat]?.health ?? 1)) || matchSnapshot?.public.current!==matchSnapshot?.private.seat || !connected || Boolean(pendingCommand)" @click="() => castSelectedSpell()">Применить заклинание</button>
        <button v-if="selectedSpellDamage?.canTargetPlayer || selectedSpellGamba || selectedSpellDiscordDramaCanTargetPlayer" class="online-secondary" :disabled="!selectedSpellSupported || Boolean(selectedSpellDiscordDrama && discordDramaMana > (matchSnapshot?.public.players[matchSnapshot.private.seat]?.mana ?? 0)) || matchSnapshot?.public.current!==matchSnapshot?.private.seat || !connected || Boolean(pendingCommand)" @click="() => castSelectedSpell({ player: 'opponent' })">Нанести урон сопернику</button><button v-if="selectedSpellGamba" class="online-secondary" :disabled="!selectedSpellSupported || matchSnapshot?.public.current!==matchSnapshot?.private.seat || !connected || Boolean(pendingCommand)" @click="() => castSelectedSpell({ player: 'self' })">Нанести урон себе</button>
        
        <div v-if="matchSnapshot" class="movement-control" :class="{ 'is-targeting': Boolean(selectedPlayCardId || selectedMoveUnitId || matchSnapshot.private.pendingChoice?.stage==='cell') }"><p v-if="selectedPlayCard">Выбрана «{{ selectedPlayCard.Name }}» — {{ selectedPlayCard.Type===1 ? 'нажмите на существо без предмета.' : selectedPlayCard.Type===2 ? (spellAreaDamage(selectedPlayCard.Description ?? '') ? 'нажмите клетку для центра области, затем примените заклинание.' : selectedSpellMove ? (selectedSpellUnitId ? 'укажите свободный сокет после применения.' : 'выберите существо' + (selectedSpellMove==='any' ? ' или здание' : '') + ' на поле.') : selectedSpellRoseZlo ? (selectedSpellUnitId ? `цель: ${matchSnapshot?.public.board.find(unit=>unit.id===selectedSpellUnitId)?.card.Name}; урон ${roseZloHealth}` : 'выберите карту на поле.') : selectedSpellDiscordDrama ? (selectedSpellUnitId ? `цель: ${matchSnapshot?.public.board.find(unit=>unit.id===selectedSpellUnitId)?.card.Name}; расход ${discordDramaMana} маны` : 'выберите карту или цель игрока по счёту.') : selectedSpellGamba ? (selectedSpellUnitId ? `цель: ${matchSnapshot?.public.board.find(unit=>unit.id===selectedSpellUnitId)?.card.Name}` : 'выберите карту на поле или выберите игрока.') : selectedSpellDamage ? (selectedSpellUnitId ? `цель: ${matchSnapshot?.public.board.find(unit=>unit.id===selectedSpellUnitId)?.card.Name}` : 'выберите карту на поле или примените заклинание к сопернику.') : 'заклинание применяется отдельной кнопкой.') : 'нажмите свободную клетку для розыгрыша.' }}</p><p v-else-if="selectedMoveUnitId">Выберите свободную клетку для движения или карту противника для атаки.</p><p v-else>Разыграйте существо или здание, экипируйте предмет на существо либо выберите свою карту для движения и атаки.</p></div><ul v-if="selectedUnitAbilities.length" class="online-ability-list" aria-label="Доступные способности выбранной карты"><li v-for="ability in selectedUnitAbilities" :key="ability.index"><template v-if="ability.operation==='adjust-next-score'"><button class="online-secondary" :disabled="matchSnapshot?.public.current!==matchSnapshot?.private.seat || !connected || Boolean(pendingCommand) || Boolean(matchSnapshot?.private.pendingChoice) || ability.tokens<ability.cost" @click="useAbility(ability.index,1)">Повысить следующий порог счёта · {{ ability.cost }} ⚫ (есть {{ ability.tokens }})</button><button class="online-secondary" :disabled="matchSnapshot?.public.current!==matchSnapshot?.private.seat || !connected || Boolean(pendingCommand) || Boolean(matchSnapshot?.private.pendingChoice) || ability.tokens<ability.cost" @click="useAbility(ability.index,-1)">Понизить следующий порог счёта · {{ ability.cost }} ⚫ (есть {{ ability.tokens }})</button></template><button v-else class="online-secondary" :disabled="matchSnapshot?.public.current!==matchSnapshot?.private.seat || !connected || Boolean(pendingCommand) || Boolean(matchSnapshot?.private.pendingChoice) || ability.resource==='black-token' && ability.tokens<ability.cost" @click="useAbility(ability.index)">{{ ability.description }} · {{ ability.cost }} {{ ability.resource==='mana' ? 'маны' : `⚫ (${ability.tokens})` }}</button></li></ul></aside><GameField v-if="matchSnapshot" :seat="matchSnapshot.private.seat" :class="{ 'is-targeting': Boolean(selectedPlayCardId || selectedMoveUnitId || matchSnapshot.private.pendingChoice?.stage==='cell') }"><template #profiles><div v-for="(profile,index) in [matchSnapshot.public.players[1-matchSnapshot.private.seat], matchSnapshot.public.players[matchSnapshot.private.seat]]" :key="profile?.name" class="player-chip player-profile" :class="{opponent:index===0,targetable:index===0&&Boolean(selectedDirectAttackUnit),'attack-ready':index===0&&Boolean(selectedDirectAttackUnit)}" :style="{'--profile-health':Math.max(0,Math.min(1,(profile?.health ?? 0)/45))}" @click="index===0&&selectedDirectAttackUnit&&attackPlayer()" @keydown.enter.prevent="index===0&&selectedDirectAttackUnit&&attackPlayer()" @keydown.space.prevent="index===0&&selectedDirectAttackUnit&&attackPlayer()" :tabindex="index===0&&selectedDirectAttackUnit?0:undefined" :role="index===0&&selectedDirectAttackUnit?'button':undefined" :aria-label="index===0 ? 'Соперник: '+profile?.name+', здоровье '+profile?.health+(selectedDirectAttackUnit ? '. Нажмите, чтобы атаковать выбранной картой' : '') : 'Вы: '+profile?.name+', здоровье '+profile?.health"><span class="profile-avatar" aria-hidden="true"><img v-if="profile?.avatarUrl" :src="profile.avatarUrl" alt=""><svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg></span><span class="profile-identity"><strong>{{ profile?.name }}</strong><small>{{ index===0 ? 'Соперник · '+profile?.handCount+' карт' : 'Вы · рука '+matchSnapshot.private.hand.length+' / '+profile?.limit }}</small></span><b class="profile-hp"><span aria-hidden="true">♥</span> {{ profile?.health }}</b></div></template><template #cell="{ row, col }"><button class="slot" :data-row="row" :data-col="col" :class="{home:row===(matchSnapshot.private.seat===0?4:0),enemy:row===(matchSnapshot.private.seat===0?0:4),opponent:boardUnitAt(row,col)?.owner!==undefined&&boardUnitAt(row,col)?.owner!==matchSnapshot.private.seat,occupied:Boolean(boardUnitAt(row,col)),'valid-target':dragging && !boardCellDisabled(row,col),'unit-dragging':dragging && drag?.kind==='unit' && drag.id===boardUnitAt(row,col)?.id,selected:boardUnitAt(row,col)?.id===selectedMoveUnitId || boardUnitAt(row,col)?.id===selectedSpellUnitId || selectedSpellCell?.row===row&&selectedSpellCell?.col===col}" :disabled="boardCellDisabled(row,col)" :aria-label="boardUnitAt(row,col) ? boardUnitAt(row,col)!.card.Name+', '+String.fromCharCode(1040+row)+(col+1)+', здоровье '+boardUnitAt(row,col)!.health : 'Свободная клетка '+String.fromCharCode(1040+row)+(col+1)" @pointerdown="boardUnitAt(row,col) && beginDrag($event,'unit',boardUnitAt(row,col)!.id)" @dragstart.prevent @click="clickBoardCell(row,col)"><span v-if="wheatAt(row,col)" class="wheat-token">⚫{{ wheatAt(row,col)>1 ? '×'+wheatAt(row,col) : '' }}</span><template v-if="boardUnitAt(row,col)"><div class="card-flipper" :class="{turned:boardUnitAt(row,col)?.flippedTurns}"><img class="board-card-art card-front" :src="cardArt(boardUnitAt(row,col)?.card.Name ?? '')" :alt="boardUnitAt(row,col)?.card.Name ?? ''"><img class="board-card-art card-back" src="/card_back.png" alt="" aria-hidden="true"></div><span v-if="!boardUnitAt(row,col)?.flippedTurns" class="hp">{{ boardUnitAt(row,col)?.health }}</span><span v-if="boardUnitAt(row,col)?.shield&&!boardUnitAt(row,col)?.flippedTurns" class="shield">◈</span><span v-if="boardUnitAt(row,col)?.flippedTurns" class="freeze-turns">{{ boardUnitAt(row,col)?.flippedTurns }}</span></template></button></template></GameField><p v-if="selectedSpellBurnGated && !matchSnapshot?.private.burnedThisTurn" aria-live="polite">Вы не сжигали карту в этом ходу: цель не будет уничтожена, но заклинание всё равно будет потрачено.</p>
        <p v-if="matchSnapshot?.public.wheatTokens.length" class="match-loading">Чёрные жетоны на клетках: {{ matchSnapshot.public.wheatTokens.map(token => String.fromCharCode(1040 + token.row) + (token.col + 1)).join(", ") }}</p>
        

        <div v-if="showTurnEnd && canInteract" class="turn-warning-backdrop"><section class="turn-warning" role="dialog" aria-modal="true" aria-label="Ход без розыгрыша"><fieldset v-if="matchSnapshot && !matchSnapshot.private.pendingChoice && matchSnapshot.public.current===matchSnapshot.private.seat && !matchSnapshot.public.players[matchSnapshot.private.seat]?.played" class="turn-end-options"><legend>Завершить ход без розыгрыша</legend><label><input v-model="endTurnOption" type="radio" value="no_penalty"> Без штрафа</label><label><input v-model="endTurnOption" type="radio" value="discard_and_decrease_limit"> Сбросить 1–2 карты и уменьшить лимит на 1 <span v-if="endTurnOption==='discard_and_decrease_limit'">({{ selectedDiscards.length }}/2 выбрано)</span></label><label><input v-model="endTurnOption" type="radio" value="increase_limit_after_round_5" :disabled="matchSnapshot.public.round<5 || matchSnapshot.private.handLimitLocked"> Увеличить лимит на 1 (с 5-го раунда)</label></fieldset><div class="warning-actions"><button class="warning-secondary" @click="showTurnEnd=false;selectedDiscards=[]">Продолжить ход</button><button class="warning-primary" :disabled="endTurnOption==='discard_and_decrease_limit' && selectedDiscards.length<1" @click="endTurn">Завершить ход</button></div></section></div>
        <button class="online-link online-concede" :disabled="!matchSnapshot || Boolean(pendingCommand)" @click="concede">Сдаться</button>
        <div v-if="dragging && dragCard" :class="[drag?.kind==='hand' ? 'hand-drag-preview' : 'board-drag-preview', {snapped:dragTarget,attack:dragTarget?.mode==='attack' || dragTarget?.mode==='player'}]" :style="{left:dragPosition.left+'px',top:dragPosition.top+'px',width:dragSize.width+'px',height:dragSize.height+'px'}"><img :src="cardArt(dragCard.Name)" :alt="dragCard.Name"></div>
        <CardInspector ref="cardInspector" />
        <p v-if="message" class="log" role="status">{{ message }}</p>
        <p v-if="!matchSnapshot" class="match-loading">Загружаем состояние партии…</p>
      </section>
    </template>
    <p v-if="message && !matchSnapshot" class="online-message" role="status">{{ message }}</p>
    <aside v-if="!matchSnapshot" class="online-note"><b>Сетевой режим</b><span>Создайте комнату и подключите второго игрока. В матч войдут выбранные колоды и профили обоих игроков; ходы передаются сопернику в реальном времени.</span></aside>
  </main>
</template>

<style scoped>
.deck-select{min-width:0;margin:1.5rem 0 0;padding:0;border:0}
.deck-select legend{color:#b7c0cf;font-size:.9rem;font-weight:700}
.online-deck-grid{width:100%;padding-top:14px;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr))}
.deck-select .online-deck-tile{position:relative;margin:0;gap:6px;min-width:0;cursor:pointer;grid-template-rows:156px auto auto 1fr;transition:border-color .15s,background .15s}
.online-deck-tile input{position:absolute;top:14px;right:14px;z-index:2;width:22px;height:22px;margin:0;accent-color:var(--theme-accent);cursor:pointer}
.online-deck-tile:has(input:disabled){cursor:not-allowed}
.online-deck-tile:hover:not(:has(input:disabled)),.online-deck-tile.selected{border-color:var(--theme-accent);background:#1c2532}
.online-deck-tile:focus-within{outline:2px solid var(--theme-accent);outline-offset:3px}
.online-deck-tile.unplayable{opacity:.5}
.deck-radio-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 .95rem Unbounded,sans-serif;letter-spacing:-.05em}
.deck-radio-meta{color:#929eae;font-size:.78rem}
.deck-radio-status{align-self:end;color:#91e5c4;font-size:.78rem}
.online-deck-tile.unplayable .deck-radio-status{color:#b7c0cf}

.online-game-root{height:100dvh;min-height:0;overflow:hidden}
.online-match-panel{width:100%;max-width:none;margin:0;border:0;border-radius:0;box-shadow:none}
.online-match-panel .slot:disabled{opacity:1;cursor:default}
.online-match-panel .profile-avatar img{width:100%;height:100%;object-fit:cover;border-radius:inherit}
.online-action-panel{position:fixed;right:28px;top:80px;z-index:18;width:min(360px,calc(100vw - 40px));max-height:45dvh;overflow:auto;padding:16px;border:1px solid var(--theme-border);border-radius:10px;background:var(--theme-surface);color:var(--theme-ink);font-size:.8rem}
.online-action-panel p{line-height:1.5}
.online-action-panel button{margin:4px;white-space:normal}
.online-concede{position:fixed;top:20px;right:28px;z-index:18}
.online-match-panel .online-choice.turn-warning{max-height:80dvh;overflow:auto}
.online-match-panel .hand-wrap.warning-discard-mode{z-index:35}
@media(max-width:780px){.online-action-panel{right:12px;top:12px;width:calc(100vw - 124px);max-height:28dvh}.online-concede{top:8px;right:12px}}

.turn-end-options{display:grid;gap:.6rem;margin-top:1rem;padding:1rem;border:1px solid #394557;border-radius:9px}.turn-end-options legend{padding:0 .35rem;color:#c3cbd6;font-size:.82rem}.turn-end-options label{display:flex;gap:.5rem;align-items:flex-start;color:#b7c0cf;font-size:.8rem}.turn-end-options label:has(input:disabled){opacity:.5}.match-actions{display:flex;justify-content:flex-end;align-items:center;gap:1rem;margin-top:1rem}

.movement-control{margin-top:1rem;color:#aeb9c8;font-size:.8rem}
.online-ability-list{list-style:none;display:grid;gap:.45rem;padding:0;margin:.65rem 0}.online-ability-list button{text-align:left;max-width:34rem}
.play-payment{display:flex;gap:1rem;margin-top:.8rem;padding:.75rem;border:1px solid #394557;border-radius:9px;color:#b7c0cf;font-size:.8rem}.play-payment legend{padding:0 .3rem}.play-payment label{display:flex;gap:.4rem;align-items:center}
.concede-button{display:block;margin:1rem 0 0 auto;color:#ffb6a1}.concede-button:disabled{opacity:.5;cursor:not-allowed}
.online-shell{min-height:100vh;padding:clamp(5rem,10vh,7.5rem) 1.25rem 4rem;background:radial-gradient(ellipse at 85% 8%,#16404b66,transparent 34rem),linear-gradient(135deg,#111625,#090b0e 70%);color:#eff1f5}
.online-back{position:absolute;top:24px;left:26px;background:none;border:0;color:#b6bdc9;cursor:pointer}
.online-heading,.online-panel,.account-bar,.online-note,.online-message{width:min(100%,760px);margin-inline:auto}
.online-heading{margin-bottom:2rem}.online-kicker{color:#91e5c4;font-size:.7rem;font-weight:800;letter-spacing:.17em}.online-heading h1{font-size:clamp(2.4rem,8vw,5.4rem);line-height:1.05;letter-spacing:-.075em}.online-heading h1 em{color:#91e5c4;font-style:normal}.online-heading>p:last-child{max-width:36rem;color:#aeb5c2;line-height:1.65}
.online-panel,.account-bar{border:1px solid #343d4c;background:#121722eF;border-radius:14px;padding:clamp(1.2rem,4vw,2rem);box-shadow:0 28px 70px #0003}.panel-title{display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem}.panel-title>span{color:var(--theme-accent);font:700 .8rem Unbounded,sans-serif}.panel-title h2{font-size:clamp(1.25rem,4vw,1.8rem);letter-spacing:-.06em}.panel-title small{display:block;color:#8d98a8;margin-top:.35rem}.auth-panel label,.deck-select label,.join-form label{display:grid;gap:.45rem;color:#b7c0cf;font-size:.85rem;margin:1rem 0}.auth-panel input,.join-form input{width:100%;border:1px solid #3a4555;border-radius:8px;background:#0c111a;color:#f1f3f7;padding:.85rem 1rem;font:inherit;min-height:46px}.online-primary,.online-secondary,.copy-code{border:0;border-radius:8px;padding:.8rem 1.1rem;font-family:inherit;font-size:.85rem;font-weight:700;cursor:pointer;transition:transform .15s,background .15s}.online-primary{background:var(--theme-accent-gradient);color:#1b1713}.online-primary:hover:not(:disabled){background:var(--theme-accent-strong);transform:translateY(-1px)}.online-secondary,.copy-code{background:#243c41;color:#c6ffea;border:1px solid #426c68}.online-secondary:hover:not(:disabled),.copy-code:hover{background:#2e4b4c}.online-primary:disabled,.online-secondary:disabled{opacity:.45;cursor:not-allowed}.online-link{border:0;background:none;color:#9fe6c9;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.auth-panel>.online-primary{width:100%;margin-top:.5rem}.auth-panel>.online-link{display:block;margin:1.1rem auto 0}.account-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;padding:1rem 1.3rem}.account-bar>div{display:grid;grid-template-columns:12px auto;column-gap:.65rem;align-items:center}.account-bar strong{font:700 .95rem Unbounded,sans-serif}.account-bar small{grid-column:2;color:#929eae}.account-state,.participant-dot{width:9px;height:9px;border-radius:50%;background:#9b6a57;box-shadow:0 0 0 4px #9b6a571e}.account-state.connected,.participant-dot.online{background:#91e5c4;box-shadow:0 0 0 4px #91e5c422}.room-actions{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.join-form{margin:0}.join-form>div{display:flex;gap:.6rem}.participants{list-style:none;padding:0;margin:0 0 1.5rem;border-top:1px solid #303949}.participants li{display:flex;align-items:center;gap:.8rem;padding:.85rem .2rem;border-bottom:1px solid #303949}.participants li>div{display:grid;gap:.2rem}.participants strong{font-size:.9rem}.participants small,.participants em{color:#8f9aaa;font-size:.75rem}.participants em{font-style:normal;margin-left:auto}.participants .vacant{color:#778292;font-size:.85rem}.copy-code{margin-left:auto;white-space:nowrap}.empty-decks,.selected-deck{color:#9eabba;font-size:.83rem;line-height:1.5}.room-footer,.room-primary-actions{display:flex;align-items:center;justify-content:space-between;gap:.6rem}.room-footer{border-top:1px solid #303949;padding-top:1rem;margin-top:1rem}.room-primary-actions{justify-content:flex-end}.online-message{margin-top:1rem;border-left:3px solid var(--theme-accent);background:#192b23;padding:.85rem 1rem;color:#ffd9c1}.online-note{display:grid;gap:.35rem;margin-top:1.5rem;color:#8793a4;font-size:.78rem;line-height:1.55}.online-note b{color:#aab6c5}.room-entry,.room-panel{margin-top:1rem}
.account-identity{display:flex!important;grid-template-columns:none!important;gap:.7rem;align-items:center}.account-identity>div{display:grid;gap:.2rem}.account-identity img,.avatar-fallback{width:40px;height:40px;border-radius:50%;object-fit:cover}.avatar-fallback{display:grid;place-items:center;background:#243c41;color:#c6ffea;font-weight:800}.account-identity .account-state{flex:none}.account-actions{display:flex!important;grid-template-columns:none!important;align-items:center;gap:1rem}

@media(max-width:600px){.online-shell{padding-inline:1rem}.room-actions{grid-template-columns:1fr}.panel-title{align-items:flex-start}.room-footer{align-items:flex-start;flex-direction:column}.room-primary-actions{width:100%}.room-primary-actions>*{flex:1}.join-form>div{align-items:stretch}.copy-code{padding:.6rem}.account-bar{padding:.9rem}.select-row{align-items:stretch}}
.wheat-token{display:block;color:#91e5c4;font-size:.72em;font-weight:700}
</style>

