export type CrownOperation =
  | { kind: 'draw'; count: number }
  | { kind: 'gain-mana'; amount: number }
  | { kind: 'increase-hand-limit'; amount: number }
  | { kind: 'heal-player'; amount: number }
  | { kind: 'heal-attacker'; amount: number }
  | { kind: 'damage-player'; amount: number }
  | { kind: 'damage-target'; amount: number; targetType?: 'creature' | 'building' }
  | { kind: 'damage-surrounding-creatures'; amount: number }
  | { kind: 'stun-target'; turns: number }
  | { kind: 'destroy-target'; targetType?: 'creature' | 'building' }
  | { kind: 'destroy-target-if-damaged'; targetType: 'creature' | 'building' }
  | { kind: 'burn-attacker-and-target' }
  | { kind: 'destroy-self' }
  | { kind: 'gain-black-token'; amount: number }
  | { kind: 'take-target-item' }
  | { kind: 'return-attacker-to-hand' }
  | { kind: 'flip-attacker'; turns: number }
  | { kind: 'destroy-target-item-or-building' }
  | { kind: 'play-saved-spell' }
  | { kind: 'move-target-adjacent' }
  | { kind: 'move-target-any' }
  | { kind: 'move-target-backward' }
  | { kind: 'gamba-damage-or-heal-target'; amount: number; damagingRolls: number[] }
  | { kind: 'move-target-sideways' }
  | { kind: 'viskas-choice' }

export type TrapOperation =
  | { kind: 'damage-attacker'; amount: number }
  | { kind: 'destroy-attacker' }
  | { kind: 'damage-attacking-player'; amount: number }
  | { kind: 'take-control-attacker' }
  | { kind: 'give-item-to-attacker-and-buff'; amount: number }

export type DeathOperation =
  | { kind: 'birdli-flip' }
  | { kind: 'newcomers' }
  | { kind: 'damage-weaken-target' }
  | { kind: 'repeat-entry-selection' }
  | { kind: 'return-equipped-item-to-deck' }
  | { kind: 'take-item-from-deck' }
  | { kind: 'take-pile-card'; source: 'deck' | 'discard'; from: 'top' | 'bottom'; cardType?: number }
  | { kind: 'save-deck-cards-by-cost'; count: number; totalCost: number }
  | { kind: 'buff-surrounding-allied-creatures'; attack: number; health: number }
  | { kind: 'save-self' }
  | { kind: 'take-discard-top-except-self'; count: number }
  | { kind: 'damage-adjacent-creatures'; amount: number }
  | { kind: 'damage-adjacent-buildings'; amount: number }
  | { kind: 'damage-all-cards'; amount: number }
  | { kind: 'damage-player'; amount: number }
  | { kind: 'heal-player'; amount: number }
  | { kind: 'draw'; count: number }
  | { kind: 'burn-flipped-card' }

export type CardEffectRules = {
  crown?: CrownOperation[]
  trap?: TrapOperation[]
  death?: DeathOperation[]
  doubleCrownAttackDamage?: boolean
  cannotDamagePlayerDirectly?: boolean
  cannotDealAttackDamage?: boolean
  damageOpponentWithCombat?: boolean
  negateNextAttack?: boolean
  canAttackFlippedCards?: boolean
  noCounterattack?: boolean
  canAttackAlliesWithoutDamage?: boolean
  healSelfToFullOnCrown?: boolean
  healPlayerByAttackOnCrown?: boolean
}

/** Explicit operations for card text that has been confirmed or is unambiguous. */
export const cardEffectRules: Record<string, CardEffectRules> = {
  'Минт': { crown: [{ kind: 'draw', count: 1 }] },
  'Вискас': { crown: [{ kind: 'viskas-choice' }] },
  'Игла': { crown: [{ kind: 'gain-black-token', amount: 1 }] },
  'Гвоздь грёз': { crown: [{ kind: 'gain-mana', amount: 3 }] },
  'Дюп': { crown: [{ kind: 'increase-hand-limit', amount: 1 }, { kind: 'gain-black-token', amount: 1 }] },
  'TheVolkeR': { crown: [{ kind: 'play-saved-spell' }] },
  'Дегра': { crown: [{ kind: 'flip-attacker', turns: 2 }] },
  'Булава': { crown: [{ kind: 'stun-target', turns: 1 }] },
  'Бримстоун': { damageOpponentWithCombat: true },
  'Бэкфлип Кеннеди': { negateNextAttack: true },
  'Рокочущий рыцарь': { crown: [{ kind: 'destroy-target-if-damaged', targetType: 'creature' }] },
  'V1': { healSelfToFullOnCrown: true, healPlayerByAttackOnCrown: true },
  'Pantlessterrorist': { doubleCrownAttackDamage: true, noCounterattack: true },
  'Пиппинс': { cannotDealAttackDamage: true },
  'Сникерс': { cannotDealAttackDamage: true },
  'ПатрикNope': { cannotDamagePlayerDirectly: true },
  'Теневой ребёнок': { cannotDamagePlayerDirectly: true },
  'Кирка ФСШ': { canAttackAlliesWithoutDamage: true, crown: [{ kind: 'destroy-target-item-or-building' }] },
  'Админский арбалет': { crown: [{ kind: 'destroy-target', targetType: 'creature' }], trap: [{ kind: 'destroy-attacker' }] },
  'Кекич': { trap: [{ kind: 'destroy-attacker' }] },
  'Мина': { trap: [{ kind: 'damage-attacker', amount: 5 }] },
  'Оранжевая': { crown: [{ kind: 'damage-player', amount: 1 }], trap: [{ kind: 'damage-attacking-player', amount: 2 }], death: [{ kind: 'damage-player', amount: 3 }] },
  'Magician Red': { crown: [{ kind: 'damage-target', amount: 1 }] },
  'Джон Фараон': { crown: [{ kind: 'destroy-target', targetType: 'creature' }] },
  'Рагна': { crown: [{ kind: 'heal-attacker', amount: 3 }] },
  'ДастАроникс': { death: [{ kind: 'draw', count: 1 }] },
  'Бёрдли': { death: [{ kind: 'birdli-flip' }] },
  'Новички': { death: [{ kind: 'newcomers' }] },
  'Ваня Веремеев': { death: [{ kind: 'buff-surrounding-allied-creatures', attack: 1, health: 1 }] },
  'Висмут Шифера': { death: [{ kind: 'repeat-entry-selection' }] },
  'Янгуша': { death: [{ kind: 'return-equipped-item-to-deck' }] },
  'Ёжик': { death: [{ kind: 'damage-weaken-target' }] },
  'Горыныч': { death: [{ kind: 'take-pile-card', source: 'discard', from: 'top', cardType: 2 }] },
  'Дрон': { death: [{ kind: 'save-deck-cards-by-cost', count: 2, totalCost: 4 }] },
  'Диохазавр': { death: [{ kind: 'save-self' }] },
  'Ноэль': { death: [{ kind: 'take-discard-top-except-self', count: 2 }] },
  'ИНТИВИ': { death: [{ kind: 'take-item-from-deck' }] },
  'Горящий тромбик': { death: [{ kind: 'burn-flipped-card' }] },
  'Жёлтый алмаз': { canAttackFlippedCards: true },
  'Броненосец': { death: [{ kind: 'heal-player', amount: 3 }] },
  'Подрывник': { death: [{ kind: 'damage-player', amount: 3 }] },
  'Джон совиный дом': { trap: [{ kind: 'take-control-attacker' }] },
  'Обсидиан пчёла': { death: [{ kind: 'damage-adjacent-creatures', amount: 2 }] },
  'Крипер': { crown: [{ kind: 'destroy-self' }], death: [{ kind: 'damage-adjacent-buildings', amount: 4 }] },
  'Собирающий жук': { trap: [{ kind: 'give-item-to-attacker-and-buff', amount: 3 }] },
  'Грави пушка': { crown: [{ kind: 'move-target-adjacent' }] },
  'Базука': { crown: [{ kind: 'damage-surrounding-creatures', amount: 1 }] },
  'Банхаммер': { crown: [{ kind: 'burn-attacker-and-target' }] },
  'Тулган': { crown: [{ kind: 'move-target-any' }] },
  'Коза': { crown: [{ kind: 'move-target-backward' }] },
  'Пилюля': { crown: [{ kind: 'gamba-damage-or-heal-target', amount: 5, damagingRolls: [1, 3, 5] }] },
  'Громила': { crown: [{ kind: 'move-target-sideways' }] },
  'Вкидгранник': { crown: [{ kind: 'return-attacker-to-hand' }] },
}

export function rulesForCard(name: string): CardEffectRules {
  return cardEffectRules[name] ?? {}
}

export function typeTokenCount(unit: { blackTokens?: number; typeTokens?: number[] }, tokenClass: number): number {
  return (unit.blackTokens ?? 0) + (unit.typeTokens?.[tokenClass] ?? 0)
}

export function crownBackwardRow(owner: number, row: number): number | null {
  const next = row + (owner === 0 ? 1 : -1)
  return next < 0 || next > 4 ? null : next
}

export function gambaTargetOutcome(roll: number, damagingRolls: number[] = [1, 3, 5]): 'damage' | 'heal' | null {
  return Number.isInteger(roll) && roll >= 1 && roll <= 6 ? damagingRolls.includes(roll) ? 'damage' : 'heal' : null
}

export function effectiveCardDescription(cardDescription: string, itemDescription = ''): string {
  // The source catalogue has a couple of misspellings in standalone trait
  // lines. Canonicalize these before any trait checks so the printed trait
  // works consistently in combat, targeting, and passive rules.
  const normalizeTraits = (description: string) => description
    .replace(/Невилимость/giu, 'Невидимость')
    .replace(/Безопаность/giu, 'Безопасность')
  const normalizedCard = normalizeTraits(cardDescription)
  const normalizedItem = normalizeTraits(itemDescription)
  return normalizedItem ? `${normalizedCard}\n${normalizedItem}` : normalizedCard
}

export type EquipOperation =
  | { kind: 'decrease-hand-limit'; amount: number }
  | { kind: 'change-attack'; amount: number }

export function effectsWhenEquipped(itemName: string): EquipOperation[] {
  if (itemName === 'Админский арбалет') return [{ kind: 'change-attack', amount: -10 }]
  return []
}

export function itemGrantsShield(description: string): boolean {
  return description.includes('Щит')
}

export function attackDamageForCard(name: string, baseDamage: number, itemName?: string, counterattack = false, target?: { health: number; maxHealth: number }): number {
  const rules = { ...rulesForCard(name), ...rulesForCard(itemName ?? '') }
  if (rules.cannotDealAttackDamage) return 0
  const damage = baseDamage + (name === 'Жалгас' && target && target.health < target.maxHealth ? 2 : 0)
  return damage * (rules.doubleCrownAttackDamage && !counterattack ? 2 : 1)
}

/** «Безопасность» permits an attack action against a friendly card, but its
 * ordinary combat damage is suppressed. Separate ability and crown effects
 * still resolve normally in the game engine. */
export function canAttackTarget(attackerName: string, attackerOwner: number, targetOwner: number, hasSafety = false): boolean {
  return attackerOwner !== targetOwner || hasSafety || Boolean(rulesForCard(attackerName).canAttackAlliesWithoutDamage)
}

export function shouldDealCombatDamage(attackerOwner: number, targetOwner: number): boolean {
  return attackerOwner !== targetOwner
}

export function canBeAttackedByCombat(description: string, attackerHasReach = false): boolean {
  return !description.includes('Клоун') && !(attackerHasReach && /не восприимчиво к атакам с досягаемостью/iu.test(description))
}

export function canAttackBoardCard(attackerName: string, targetDescription: string, flipped: boolean, attackerHasReach = false): boolean {
  return flipped ? Boolean(rulesForCard(attackerName).canAttackFlippedCards) : canBeAttackedByCombat(targetDescription, attackerHasReach)
}

export function mustTargetClown(actorOwner: number, targetOwner: number | undefined, targetIsClown: boolean, legalEnemyClownExists: boolean): boolean {
  return legalEnemyClownExists && (targetOwner === undefined || targetOwner === actorOwner || !targetIsClown)
}

export function mustChooseRemainingClown(targetIsClown: boolean, unselectedClowns: number, remainingSlots: number): boolean {
  return !targetIsClown && unselectedClowns >= remainingSlots
}

export function effectCanTargetEnemy(description: string): boolean {
  const restrictedToAllies = /(?:ваш[а-яё]*|союзн[а-яё]*)/iu.test(description)
  const explicitlyTargetsEnemies = /вражеск[а-яё]*/iu.test(description)
  return !restrictedToAllies || explicitlyTargetsEnemies
}

export function effectCanTargetPlayer(description: string): boolean {
  return /выбранн(?:ой|ую)\s+цел[ьиу]/iu.test(description) && !/существ|здан|противник/iu.test(description)
}

export function spellCanTargetPlayer(description: string): boolean {
  return (selectedTargetDamage(description) !== null || gambaDamageOperation(description) !== null) && !/существ|здан|карт/iu.test(description)
}

export function targetKindInDescription(description: string): 'creature' | 'building' | undefined {
  if (/существ/iu.test(description) && /здан/iu.test(description)) return undefined
  if (/существ/iu.test(description)) return 'creature'
  if (/здан/iu.test(description)) return 'building'
  return undefined
}

export function targetMatchesKind(cardType: number, targetKind?: 'creature' | 'building'): boolean {
  return !targetKind || (targetKind === 'creature' ? cardType === 0 : cardType === 3)
}

export function selectedTargetDamage(description: string): number | null {
  const match = description.match(/(?:Нанесите|Наносит)\s+(\d+)\s+урон(?:а)?/iu)
  return match ? Number(match[1]) : null
}

export function spellAreaDamage(description: string): { amount: number; height: number; width: number } | null {
  const match = description.match(/Нанесите\s+(\d+)\s+урона?\s+всем\s+существ[а-яё]*\s+по\s+площади\s+(\d+)\s*[xх×]\s*(\d+)\s+сокет/iu)
  return match ? { amount: Number(match[1]), height: Number(match[2]), width: Number(match[3]) } : null
}

export function spellLineDamage(description: string): number | null {
  const match = description.match(/^Наносит\s+(\d+)\s+урона?\s+по\s+линии\s+всем\s+существам\.?$/iu)
  return match ? Number(match[1]) : null
}

export function spellLineBuff(description: string): number | null {
  const match = description.match(/^Даёт\s+всем\s+картам\s+на\s+линии\s+\+(\d+)\s*⚔️❤️⚡\.?$/u)
  return match ? Number(match[1]) : null
}

export function spellBurnsCreature(description: string): boolean {
  return /^Сожгите\s+выбранное\s+существо\.?$/iu.test(description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim())
}

export function spellKillsCreature(description: string): boolean {
  return /^Убейте\s+существо\.?$/iu.test(description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim())
}

export function spellKillsFlippedCreatureCount(description: string): boolean {
  return /^Убейте столько существ(?:о)?, сколько перевёрнутых карт сейчас на поле\.?$/iu.test(description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim())
}

export function spellAuctionsCreatures(description: string): boolean {
  return /^Возьмите все карты существ находящихся на поле, перемешайте\.\s*После чего возьмите верхнее существо из получившейся "Колоды"\.\s*Оно оста[её]ться на сокете владельца, а все остальные умирают\.?$/iu.test(description.trim())
}

export function spellSacrificesTwoAllies(description: string): boolean {
  return /^Уничтожает двух ваших существ и накложите на всех вражеских -1⚔️ -2\.?$/iu.test(description.trim())
}

export function spellMovesTargetToSocket(description: string): 'any' | 'opponent' | null {
  const text = description.trim()
  if (/^Перенесите цель заклинания в выбранный незанятый сокет\.?$/iu.test(text)) return 'any'
  if (/^Перенесите выбранное существо на любой не занятый сокет противника\.?$/iu.test(text)) return 'opponent'
  return null
}

export function spellBurnsAllCreatures(description: string): boolean {
  return /^Сожгите\s+всех\s+существ\s+на\s+поле\.?$/iu.test(description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim())
}

export function spellGlobalCreatureDamage(description: string): number | null {
  const match = description.match(/^Нанесите\s+(\d+)\s+урон(?:а)?\s+всем\s+существам\s+на\s+поле\.?$/iu)
  return match ? Number(match[1]) : null
}

export function spellDestroysBuilding(description: string): boolean {
  return /^Уничтожьте\s+здание\.?$/iu.test(description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim())
}

export function spellTargetTransfer(description: string): 'discard' | 'hand' | null {
  const text = description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim()
  if (/^Сбросьте выбранное существо или здание\.?$/iu.test(text)) return 'discard'
  if (/^Верните выбранную карту обратно в руку\.?$/iu.test(text)) return 'hand'
  return null
}

export function spellDiscardsToOpponent(description: string): boolean {
  return /^Сбросьте это заклинание в КС противника\.?$/iu.test(description.trim())
}

export function spellSwapsCreatureStats(description: string): boolean {
  return /^Выберите 2 существа, они меняются ⚪ и ⚫\.?$/u.test(description.trim())
}

type CreatureStats = { attack?: number; health?: number; maxHealth?: number; speed?: number; energyCostReduction?: number; blackTokens?: number; temporaryAttack?: number; temporaryHealth?: number; temporaryHealthExpiresAt?: number; doggoBuffs?: number; cardPlayBuffs?: number; typeTokens?: number[] }

export function swapCreatureStats<T extends CreatureStats>(first: T, second: T): void {
  for (const key of ['attack', 'health', 'maxHealth', 'speed', 'energyCostReduction', 'blackTokens', 'temporaryAttack', 'temporaryHealth', 'temporaryHealthExpiresAt', 'doggoBuffs', 'cardPlayBuffs'] as const) [first[key], second[key]] = [second[key], first[key]]
  ;[first.typeTokens, second.typeTokens] = [second.typeTokens, first.typeTokens]
}

export function spellAreaTargets<T extends { row: number; col: number; card: { Type: number }; dying?: boolean; flippedTurns?: number }>(units: T[], center: { row: number; col: number }, height: number, width: number): T[] {
  return units.filter(unit => unit.card.Type === 0 && !unit.dying && !unit.flippedTurns && Math.abs(unit.row - center.row) <= Math.floor(height / 2) && Math.abs(unit.col - center.col) <= Math.floor(width / 2))
}

export function selectedDamageAndHeal(description: string): { damage: number; heal: number } | null {
  const match = description.match(/Нанесите\s+выбранной\s+цели\s+(\d+)\s+урона?\s+и\s+затем\s+восстановите\s+себе\s+(\d+)\s+здоровья/iu)
  return match ? { damage: Number(match[1]), heal: Number(match[2]) } : null
}

export function spellFlipOnKill(description: string): number | null {
  const match = description.match(/Если это заклинание убивает цель, она остаётся в сокете ещё на (\d+) хода? в перевёрнутом состоянии/iu)
  return match ? Number(match[1]) : null
}

export function spellSavesHandOnCreatureKill(description: string): boolean {
  return /если\s+"Знаком по ебалу"\s+убивает\s+существо,\s+сберегите\s+1\s+карту\s+в\s+руке\.?$/iu.test(description.trim())
}

export function spellHealsCasterOnCreatureKill(description: string): boolean {
  return /Вы восстанавливаете количество здоровья равное здоровью существа,\s*если цель погибает\.?$/iu.test(description.trim())
}

export function healthPaymentDamage(description: string): { target: 'card' } | null {
  return /Потратьте\s+столько\s+здоровья,\s*сколько\s+хотите\s+нанести\s+урона\s+выбранной\s+карте/iu.test(description) ? { target: 'card' } : null
}

export function spellSelfDamage(description: string): number | null {
  const match = description.match(/получите\s+(\d+)\s+урона/iu)
  return match ? Number(match[1]) : null
}

export function targetedSpellDamage(description: string): { amount: number; targetType: 'creature' | 'building' | undefined; canTargetPlayer: boolean; heal: number; selfDamage: number } | null {
  const rawText = description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim()
  let text = rawText
  if (spellFlipOnKill(rawText) !== null) text = rawText.replace(/\s*Если это заклинание убивает цель, она остаётся в сокете ещё на \d+ хода? в перевёрнутом состоянии\.?$/iu, '').trim()
  else if (spellSavesHandOnCreatureKill(rawText)) text = rawText.replace(/,?\s*если\s+"Знаком по ебалу"\s+убивает\s+существо,\s+сберегите\s+1\s+карту\s+в\s+руке\.?$/iu, '').trim()
  else if (spellHealsCasterOnCreatureKill(rawText)) text = rawText.replace(/\s*Вы восстанавливаете количество здоровья равное здоровью существа,\s*если цель погибает\.?$/iu, '').trim()
  const combined = text.match(/^Нанесите выбранной цели\s+(\d+)\s+урона?\s+и затем восстановите себе\s+(\d+)\s+здоровья\.?$/iu)
  const simple = text.match(/^Нанесите\s+(\d+)\s+урон(?:а)?\s+выбранн(?:ой\s+(?:цели|карте)|ому\s+(?:существу|зданию))(?:\s+и получите\s+(\d+)\s+урона?)?\.?$/iu)
  if (!combined && !simple) return null
  return {
    amount: Number(combined?.[1] ?? simple?.[1]),
    targetType: targetKindInDescription(text),
    canTargetPlayer: spellCanTargetPlayer(text) || effectCanTargetPlayer(text),
    heal: Number(combined?.[2] ?? 0),
    selfDamage: Number(simple?.[2] ?? 0),
  }
}

export type GlobalHealingOperation =
  | { kind: 'heal-both-players'; amount: number }
  | { kind: 'heal-controller-and-units'; amount: number }
  | { kind: 'heal-controller-per-creature'; amount: number }
  | { kind: 'heal-own-board' }

/** Identify healing spells whose wording targets players or a whole side. */
export function globalHealingOperation(description: string): GlobalHealingOperation | null {
  if (/Полностью восстанавливает здоровье всех ваших существ и зданий\.?/iu.test(description)) return { kind: 'heal-own-board' }
  const bothPlayers = description.match(/Восстановите\s+(\d+)\s+здоровья\s+обоим\s+игрокам/iu)
  if (bothPlayers) return { kind: 'heal-both-players', amount: Number(bothPlayers[1]) }
  const side = description.match(/Восстановите\s+себе\s+и\s+своим\s+существам\s+(\d+)\s+здоровья/iu)
  if (side) return { kind: 'heal-controller-and-units', amount: Number(side[1]) }
  const perCreature = description.match(/Восстановите\s+(\d+)\s+здоровья\s+за\s+каждое\s+существо\s+на\s+поле/iu)
  if (perCreature) return { kind: 'heal-controller-per-creature', amount: Number(perCreature[1]) }
  return null
}

export function playerHealAmount(description: string): number | null {
  if (/обоим игрокам|за каждое существо|вашему существу|выбранн|выбранному существу/iu.test(description)) return null
  const match = description.match(/Вос?становите\s+(?:себе\s+)?(\d+)\s+здоровья/iu)
  return match ? Number(match[1]) : null
}

export function flexibleHealOrStunEffect(description: string): { heal: number; turns: number } | null {
  const match = description.match(/Восстановите\s+(\d+)\s+здоровья\s+вашему\s+существу,?\s+(?:либо\s+же|или)\s+наложите\s+оглушение\s+(\d+)\s+на\s+вражеское/iu)
  return match ? { heal: Number(match[1]), turns: Number(match[2]) } : null
}

export function cardBurnEffect(description: string): { kind: 'heal-and-draw'; heal: number; draw: number } | null {
  const trigger = /Если\s+.{1,60}сжиг[а-яё]*,?\s*(?:тогда\s+)?примените\s+её\s+эффект/iu.test(description)
  const effect = description.split(/Если/iu)[0] ?? ''
  const heal = effect.match(/Восстановите\s+(\d+)\s+здоровья/iu)
  const draw = effect.match(/Возьмите\s+(\d*)\s*карт(?:у|ы)?/iu)
  if (!trigger || !heal || !draw) return null
  return { kind: 'heal-and-draw', heal: Number(heal[1]), draw: Math.max(1, Number(draw[1] || 1)) }
}

export function hasBurnTrait(description: string): boolean {
  return /(?:^|[.!?]\s*|\r?\n)\s*Сжига(?:ется|еться)\.?\s*$/imu.test(description)
}

export function spellHealAndDrawEffect(description: string): ReturnType<typeof cardBurnEffect> {
  return /^Восстановите\s+\d+\s+здоровья\s+и\s+возьмите\s+карту\.\s+Если\s+.{1,60}сжиг[а-яё]*,?\s*(?:тогда\s+)?примените\s+её\s+эффект\.?$/iu.test(description) ? cardBurnEffect(description) : null
}

export function burnsOnDeathFromField<T extends { card: { Name: string }; flippedTurns?: number; dying?: boolean }>(cardType: number, units: T[]): boolean {
  return cardType === 0 && units.some(unit => unit.card.Name === 'Варан' && !unit.flippedTurns && !unit.dying)
}

export function spellCastEvent(description: string): 'cast' | 'burn' {
  return hasBurnTrait(description) ? 'burn' : 'cast'
}

export function applyCardEventEffect(description: string, event: 'cast' | 'burn' | 'discard', heal: (amount: number) => void, draw: (count: number) => void): boolean {
  if (event === 'discard') return false
  const effect = cardBurnEffect(description)
  if (!effect) return false
  heal(effect.heal)
  draw(effect.draw)
  return true
}

export function takeCardFromHand<T extends { Description?: string }>(hand: T[], discard: T[], burned: T[], index: number, event: 'cast' | 'burn' | 'discard', heal: (amount: number) => void, draw: (count: number) => void, onBurn?: (card: T) => boolean | void): T | null {
  const [card] = hand.splice(index, 1)
  if (!card) return null
  let shouldBurn = event === 'burn'
  if (event === 'burn') {
    if (onBurn) shouldBurn = onBurn(card) !== false
    else burned.push(card)
  } else discard.push(card)
  if (event === 'burn' && !shouldBurn) return card
  applyCardEventEffect(card.Description ?? '', event, heal, draw)
  return card
}

export function removePlayedCardFromHand<T>(hand: T[], index: number): T | null {
  return hand.splice(index, 1)[0] ?? null
}

export function finishSpellFromHand<T extends { Description?: string }>(hand: T[], discard: T[], burned: T[], index: number, heal: (amount: number) => void, draw: (count: number) => void, onBurn?: (card: T) => boolean | void): T | null {
  const card = hand[index]
  return card ? takeCardFromHand(hand, discard, burned, index, spellCastEvent(card.Description ?? ''), heal, draw, onBurn) : null
}

export function gainBurnTriggerTokens<T extends { card: { Name?: string }; owner: number; blackTokens: number; flippedTurns?: number; dying?: boolean }>(units: T[], owner: number): number {
  const activeIcebergs = units.filter(unit => unit.card.Name === 'Айсберг' && unit.owner === owner && !unit.flippedTurns && !unit.dying)
  activeIcebergs.forEach(unit => unit.blackTokens++)
  return activeIcebergs.length
}

/** A face-down creature remains on the field and counts for field-wide text. */
export function countCreaturesOnField<T extends { type: number; dying?: boolean }>(cards: T[]): number {
  return cards.filter(card => card.type === 0 && !card.dying).length
}

export function effectConditionMet(description: string, burnedCardThisTurn: boolean): boolean {
  return !/если\s+вы\s+сожгли\s+свою\s+карту\s+в\s+этом\s+ходу/iu.test(description) || burnedCardThisTurn
}

export function burnGatedSpellOperation(description: string): { kind: 'destroy-target'; targetType: 'creature' } | null {
  return /Убивает\s+выбранное\s+существо,\s*если\s+вы\s+сожгли\s+свою\s+карту\s+в\s+этом\s+ходу/iu.test(description)
    ? { kind: 'destroy-target', targetType: 'creature' }
    : null
}

export function scoreConditionMet(description: string, count: number, thresholdAdjustment = 0): boolean {
  const score = description.match(/Счёт\s*(?:(\d+)\s*([<>≤≥])|([<>≤≥])\s*(\d+)|(\d+))/iu)
  if (!score) return false
  const value = Number(score[1] ?? score[4] ?? score[5]) + thresholdAdjustment
  if (score[2]) return score[2] === '>' || score[2] === '≥' ? count >= value : count <= value
  if (score[3]) return score[3] === '>' ? count > value : score[3] === '≥' ? count >= value : score[3] === '≤' ? count <= value : count < value
  return count === value
}

export function discordDramaEffect(description: string, mana: number, target: 'card' | 'player', handCount: number, thresholdAdjustment = 0): { canTargetPlayer: boolean; damage: number } {
  const canTargetPlayer = scoreConditionMet(description, handCount, thresholdAdjustment)
  return { canTargetPlayer, damage: mana * (target === 'player' && canTargetPlayer ? 2 : 1) }
}

export function scoreDiscountedCost(cost: number, description: string, handCount: number, discount: number, existingDiscount = 0): number {
  return scoreConditionMet(description, handCount) ? Math.max(0, cost - discount - existingDiscount) : Math.max(0, cost - existingDiscount)
}

export function scoreExtraDrawCount(description: string, handCount: number, thresholdAdjustment = 0): number {
  if (!scoreConditionMet(description, handCount, thresholdAdjustment)) return 0
  const match = description.match(/Счёт[^:\r\n]*:\s*[^\r\n]*Возьмите\s+ещё\s+(\d+)\s+карт/iu)
  return match ? Number(match[1]) : 0
}

export function consumeNextScoreAdjustment<T extends { nextScoreAdjustment: number }>(player: T, description: string): number {
  if (!/Счёт/iu.test(description)) return 0
  const adjustment = player.nextScoreAdjustment
  player.nextScoreAdjustment = 0
  return adjustment
}

export function returnCardToHand<TCard, TUnit extends { id: string; card: TCard; item?: TCard }>(board: TUnit[], hand: TCard[], discard: TCard[], id: string): TUnit | null {
  const index = board.findIndex(unit => unit.id === id)
  if (index < 0) return null
  const unit = board.splice(index, 1)[0]
  if (!unit) return null
  if (unit.item) discard.push(unit.item)
  hand.push(unit.card)
  return unit
}

export function hasTemporaryRage(description: string, temporaryRage: boolean): boolean {
  return temporaryRage || description.includes('Ярость')
}

export function grantsRageUntilOwnerEnd(description: string): boolean {
  return /Дайте\s+существу\s+ярость,?\s+в\s+конце\s+хода\s+владельца\s+оно\s+умирает/iu.test(description)
}

export function destroysFlippedThenFlipsSurvivors(description: string): number | null {
  const text = description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim()
  const match = text.match(/^Уничтожьте все перевёрнутые карты\.\s*Примените переверот\s+(\d+)\s+оставшимся\.?$/iu)
  return match ? Number(match[1]) : null
}

export function movementIsBlocked(blockedPlayer: number | null, activePlayer: number): boolean {
  return blockedPlayer === activePlayer
}

export function creaturePushLine<T extends { id: string; card: { Name: string; Type: number }; row: number; col: number; item?: { Name: string }; flippedTurns?: number; dying?: boolean }>(board: T[], activePlayer: number, row: number, col: number, blockedPlayer: number | null): T[] | null {
  if (movementIsBlocked(blockedPlayer, activePlayer)) return null
  const direction = activePlayer === 0 ? -1 : 1
  const line: T[] = []
  for (let nextRow = row; nextRow >= 0 && nextRow < 5; nextRow += direction) {
    const unit = board.find(candidate => candidate.row === nextRow && candidate.col === col)
    if (!unit) return line.length ? line : null
    if (unit.card.Type === 3 || unitMovementBlocked(unit) || !unitCanMoveAndAttack(unit, board)) return null
    line.push(unit)
  }
  return null
}

export function unitMovementBlocked(unit: { item?: { Name: string }; flippedTurns?: number; dying?: boolean }): boolean {
  return unit.item?.Name === 'Закреп' && !unit.flippedTurns && !unit.dying
}

export function unitCanMoveAndAttack(unit: { id: string; card: { Name: string }; row: number; col: number; flippedTurns?: number }, field: { id: string; card: { Type: number }; row: number; col: number; dying?: boolean }[]): boolean {
  return unit.card.Name !== 'Манекен' || Boolean(unit.flippedTurns) || !field.some(other => other.id !== unit.id && other.card.Type === 0 && !other.dying && Math.max(Math.abs(other.row-unit.row),Math.abs(other.col-unit.col)) === 1)
}

export function canMoveTo(fromRow: number, fromCol: number, row: number, col: number, diagonal = false): boolean {
  const dr = Math.abs(fromRow - row), dc = Math.abs(fromCol - col)
  return diagonal ? dr <= 1 && dc <= 1 && dr + dc > 0 : dr + dc === 1
}

export function forwardMoveDestination(owner: number, row: number, col: number, occupied: boolean, movementBlocked = false, rowCount = 5): { row: number; col: number } | null {
  if (movementBlocked) return null
  const nextRow = row + (owner === 0 ? -1 : 1)
  return nextRow >= 0 && nextRow < rowCount && !occupied ? { row: nextRow, col } : null
}

export function canCounterattack(defenderName: string, defenderIsCreature: boolean, attackWasDiagonal: boolean, attackerHasReach: boolean, defenderHasReach: boolean, defenderHasAudit: boolean, defenderItemName?: string): boolean {
  const auditAllowsReturnDamage = defenderHasAudit && attackerHasReach
  return defenderIsCreature && !rulesForCard(defenderName).noCounterattack && !rulesForCard(defenderItemName ?? '').noCounterattack && (!attackWasDiagonal || defenderHasReach || auditAllowsReturnDamage)
}

export function attackWasDiagonal(attackerRow: number, attackerCol: number, targetRow: number, targetCol: number): boolean {
  return Math.abs(attackerRow - targetRow) === 1 && Math.abs(attackerCol - targetCol) === 1
}

export function effectsForTrigger(name: string, trigger: 'crown' | 'trap' | 'death'): Array<CrownOperation | TrapOperation | DeathOperation> {
  const effects = rulesForCard(name)[trigger]
  return effects ? [...effects] : []
}

export function resolveAttackStages(dealCombatDamage: () => void, resolveCrown: () => void, resolveTrap: () => void, resolveDeaths: () => void): void {
  try {
    dealCombatDamage()
    resolveCrown()
    resolveTrap()
  } finally {
    resolveDeaths()
  }
}

export function resolveStartTurnStages(resetTurnState: () => void, resolveStartEffects: () => void, settleHandLimit: () => void, grantPassiveResources: () => void): void {
  resetTurnState()
  resolveStartEffects()
  settleHandLimit()
  grantPassiveResources()
}

export function tickFlipAtOwnerEnd(health: number, flippedTurns: number): { flippedTurns: number; dies: boolean; reveals: boolean } {
  const nextTurns = Math.max(0, flippedTurns - 1)
  return { flippedTurns: nextTurns, dies: nextTurns === 0 && health <= 0, reveals: nextTurns === 0 && health > 0 }
}

export function initialFlipTurns(description: string): number {
  const traits = description.split(/\r?\n(?=\s*(?:Вход|Постоянно|Посмертно|Коронный|Ловушка|Способность|Счёт|Гамба|Хорни)\s*:)/iu)[0] ?? ''
  return Number(traits.match(/(?:^|\s)Переворот\s+(\d+)/iu)?.[1] ?? 0)
}

export function globalFlipTurns(description: string): number | null {
  const match = description.match(/^Примените\s+переворот\s+(\d+)\s+всем\s+картам\s+на\s+поле\.?\s*$/iu)
  return match ? Number(match[1]) : null
}

export function targetedSpellFlipTurns(description: string): number | null {
  const match = description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim().match(/^Дайте\s+переворот\s+(\d+)\s+выбранному\s+существу\.?$/iu)
  return match ? Number(match[1]) : null
}

export function targetedSpellStunTurns(description: string): number | null {
  const match = description.replace(/\s*Сжига(?:ется|еться)\.?\s*$/iu, '').trim().match(/^Выбранное\s+существо\s+получает\s+оглушение\s+(\d+)\.?$/iu)
  return match ? Number(match[1]) : null
}

export function spellBuffToEndTurnDeath(description: string): { attack: number; health: number; speed: number } | null {
  const match = description.match(/^Ваше\s+существо\s+получает\s+(\d+)\s+(\d+)\s+(\d+),?\s+но\s+в\s+конце\s+вашего\s+хода\s+оно\s+умирает\.?$/iu)
  return match ? { attack: Number(match[1]), health: Number(match[2]), speed: Number(match[3]) } : null
}

export function entryFieldFlipTurns(description: string): number | null {
  const match = description.match(/Вход\s*:\s*Накладывает\s+Переворот\s+(\d+)\s+на\s+все\s+карт(?:ы|ам)\s+на\s+поле\s+кроме\s+себя/iu)
  return match ? Number(match[1]) : null
}

export function canActWhileFlipped(description: string): boolean {
  return /может атаковать и передвигаться в состоянии переворота/iu.test(description)
}

export function flipTimerTicks(description: string): boolean {
  return !/не сбрасывает жетоны переворота в конце вашего хода/iu.test(description)
}

export function shouldFinalizeDeath(health: number, explicitlyDestroyed: boolean): boolean {
  return explicitlyDestroyed || health <= 0
}

export function killRewardForCard(sourceName: string, sourceOwner: number, targetOwner: number, targetType: number): { attack: number; shield?: true } | null {
  if (sourceName === 'V1') return { attack: 1 }
  return sourceName === 'Ghorze' && sourceOwner !== targetOwner && targetType === 0 ? { attack: 1, shield: true } : null
}

export function scavengerSwarmSources<T extends { owner: number; card: { Name: string; Type?: number }; item?: { Name: string }; dying?: boolean; flippedTurns?: number }>(units: T[], owner: number, deadType: number): T[] {
  return deadType === 0 ? units.filter(unit => unit.owner === owner && unit.card.Type === 0 && !unit.dying && !unit.flippedTurns && (unit.card.Name === 'Загребущий рой' || unit.item?.Name === 'Загребущий рой')) : []
}

export type StartTurnOperation =
  | { kind: 'draw'; count: number }
  | { kind: 'gain-mana'; amount: number }
  | { kind: 'gain-energy'; amount: number }
  | { kind: 'damage-player'; amount: number; target?: 'owner' | 'opponent' }
  | { kind: 'move-self-forward' }
  | { kind: 'gamba-destroy-self'; maximumRoll: number }
  | { kind: 'gamba-heal-allies-or-damage-enemies'; amount: number; healingRolls: number[] }
  | { kind: 'burn-hand-card'; count: number }
  | { kind: 'burn-hand-card-if-hand-limit-at-least'; minimumLimit: number; count: number }
  | { kind: 'shield-surrounding-creature' }
  | { kind: 'play-cheapest-creature-adjacent' }
  | { kind: 'burn-weakest-creature' }
  | { kind: 'take-top-discard' }

export type StartTurnEffect = { scope: 'owner-turn' | 'every-turn'; operations: StartTurnOperation[] }

export function startTurnEffect(description: string): StartTurnEffect | null {
  const trigger = description.match(/В начале (вашего |каждого |своего )?хода([^\r\n]*)/iu)
  if (!trigger) return null
  // Some card text puts the action before “в начале хода” (for example,
  // “Наносит противнику 5 урона в начале хода”), so parse the whole line.
  const clause = description.split(/\r?\n/u).find(line => /В начале (?:вашего |каждого |своего )?хода/iu.test(line)) ?? trigger[2] ?? ''
  const ordered: Array<{ at: number; operation: StartTurnOperation }> = []
  const conditionalBurn = description.match(/Если у вас лимит карт\s*(\d+)\s+и больше,\s*сожгите\s+(\d+)\s+карт(?:у|ы)/iu)
  if (conditionalBurn) ordered.push({ at: description.indexOf(conditionalBurn[0]), operation: { kind: 'burn-hand-card-if-hand-limit-at-least', minimumLimit: Number(conditionalBurn[1]), count: Number(conditionalBurn[2]) } })
  const teamGamba = description.match(/Гамба:\s*([\d,\s]+)\s*[-–]\s*Восстанавливает\s+(\d+)\s+здоровье\s+вам\s+и\s+всем\s+вашим\s+существам[\s\S]*?\n\s*([\d,\s]+)\s*[-–]\s*Наносит\s+(\d+)\s+урона\s+всем\s+врагам\s+включая\s+противника/iu)
  if (teamGamba) ordered.push({ at: 0, operation: { kind: 'gamba-heal-allies-or-damage-enemies', amount: Number(teamGamba[2]), healingRolls: teamGamba[1]!.split(/\s*,\s*/u).map(Number) } })
  if (/выставьте рядом с Сент-круа самое деш[её]вое существо из руки/iu.test(description)) ordered.push({ at: 0, operation: { kind: 'play-cheapest-creature-adjacent' } })
  if (/сожгите самое слабое существо на поле \[Кроме Дедруби\]/iu.test(clause)) ordered.push({ at: 0, operation: { kind: 'burn-weakest-creature' } })
  const selfDeath = description.slice(trigger.index).match(/Гамба:\s*\r?\n\s*1\s*[-–]\s*(\d+)\s*[-–]\s*умирает\.?\s*\r?\n\s*\d+\s*[-–]\s*6\s*[-–]\s*Ничего не происходит/iu)
  if (selfDeath) ordered.push({ at: 0, operation: { kind: 'gamba-destroy-self', maximumRoll: Number(selfDeath[1]) } })
  for (const sentence of clause.matchAll(/[^.!?]+/gu)) {
    const text = sentence[0]
    const offset = sentence.index ?? 0
    if (/\bесли\b|за кажд/iu.test(text)) continue
    if (/Вы можете вытащить 1 карту из КД,\s*в начале хода/iu.test(text)) ordered.push({ at: offset, operation: { kind: 'take-top-discard' } })
    const draw = text.match(/Возьмите\s+(\d*)\s*карт(?:у|ы)?/iu)
    if (draw?.index !== undefined) ordered.push({ at: offset + draw.index, operation: { kind: 'draw', count: Math.max(1, Number(draw[1] || 1)) } })
    const gainText = text.match(/Получ[а-яё]*[^.]*$/iu)?.[0] ?? ''
    for (const gain of gainText.matchAll(/(\d+)\s*(ман|энерг)/giu)) {
      ordered.push({ at: offset + text.indexOf(gainText) + (gain.index ?? 0), operation: { kind: gain[2]?.toLowerCase() === 'ман' ? 'gain-mana' : 'gain-energy', amount: Number(gain[1]) } })
    }
    const loss = text.match(/Теря[а-яё]*\s+(\d+)\s+здоров/iu)
    if (loss?.index !== undefined) ordered.push({ at: offset + loss.index, operation: { kind: 'damage-player', amount: Number(loss[1]) } })
    const enemyDamage = text.match(/Наносит\s+(?:противнику|врагу)\s+(\d+)\s+урона/iu)
    if (enemyDamage?.index !== undefined) ordered.push({ at: offset + enemyDamage.index, operation: { kind: 'damage-player', amount: Number(enemyDamage[1]), target: 'opponent' } })
    const moveForward = text.match(/передвига[а-яё]*\s+впер[её]д\s+на\s+1\s+сокет/iu)
    if (moveForward?.index !== undefined) ordered.push({ at: offset + moveForward.index, operation: { kind: 'move-self-forward' } })
    const burn = text.match(/Сожгите\s+(\d+)\s+карт(?:у|ы)\s+из\s+(?:вашей|своей)\s+руки/iu)
    if (burn?.index !== undefined) ordered.push({ at: offset + burn.index, operation: { kind: 'burn-hand-card', count: Number(burn[1]) } })
    const shield = text.match(/дайте\s+щит\s+выбранному\s+существу\s+вокруг/iu)
    if (shield?.index !== undefined) ordered.push({ at: offset + shield.index, operation: { kind: 'shield-surrounding-creature' } })
  }
  ordered.sort((a, b) => a.at - b.at)
  return ordered.length ? { scope: trigger[1]?.trim() === 'каждого' ? 'every-turn' : 'owner-turn', operations: ordered.map(item => item.operation) } : null
}

export function cheapestCreatureIndexes(hand: Array<{ Type: number; Cost?: number }>): number[] {
  const cheapest = Math.min(...hand.filter(card => card.Type === 0 && Number.isFinite(card.Cost)).map(card => card.Cost!))
  return Number.isFinite(cheapest) ? hand.flatMap((card, index) => card.Type === 0 && card.Cost === cheapest ? [index] : []) : []
}

export function freeAdjacentSockets(row: number, col: number, units: Array<{ row: number; col: number }>): Array<{ row: number; col: number }> {
  const occupied = new Set(units.map(unit => `${unit.row},${unit.col}`))
  const sockets: Array<{ row: number; col: number }> = []
  for (let targetRow = Math.max(0, row - 1); targetRow <= Math.min(4, row + 1); targetRow++) {
    for (let targetCol = Math.max(0, col - 1); targetCol <= Math.min(4, col + 1); targetCol++) {
      if ((targetRow !== row || targetCol !== col) && !occupied.has(`${targetRow},${targetCol}`)) sockets.push({ row: targetRow, col: targetCol })
    }
  }
  return sockets
}

export type EntryTargetOperation =
  | { kind: 'take-target-item' }
  | { kind: 'damage-target'; amount: number }
  | { kind: 'give-type-tokens-if-none'; count: number }
  | { kind: 'save-allied-card' }
  | { kind: 'save-target' }
  | { kind: 'save-flipped' }
  | { kind: 'destroy-building' }
  | { kind: 'take-enemy-building' }
  | { kind: 'move-building-one' }
  | { kind: 'heal-creature'; flipTurns?: number; amount?: number }
  | { kind: 'heal-allied-creatures-and-gain-energy'; heal: number; energy: number }
  | { kind: 'sacrifice-ally-heal-player'; amount: number }
  | { kind: 'return-creature-to-hand' }
  | { kind: 'stun-target'; turns: number; targetOwner: 'ally' | 'enemy' | 'any'; condition?: 'burned-this-turn' }
  | { kind: 'gamba-damage-each-creature'; maximumRoll: number }

export function entryDrawCount(description: string): number | null {
  const entryText = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  const draw = entryText.match(/Возьмите\s+(\d*)\s*карт(?:у|ы)?/iu)
  return draw ? Math.max(1, Number(draw[1] || 1)) : null
}

export function entryDrawToHandSize(description: string): number | null {
  const entryText = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  const match = entryText.match(/бер(?:и|ите)\s+карт[уы]?\s+пока их у вас не будет\s+(\d+)/iu)
  return match ? Number(match[1]) : null
}

export function spellDrawAndLimitEffect(description: string): { drawCount: number; opponentLimit: number } | null {
  const effect = description.match(/Возьмите\s+(\d+)\s+карт(?:ы|у)\s+и\s+увеличьте\s+лимит\s+карт\s+противника\s+на\s+(\d+)\s+до\s+конца\s+его\s+хода/iu)
  return effect ? { drawCount: Number(effect[1]), opponentLimit: Number(effect[2]) } : null
}

export function spellDrawCount(description: string): number | null {
  const effect = description.match(/^Возьмите(?:\s+(\d+))?\s+карт(?:у|ы)\.?(?:\s+Счёт\s+\d+[<>≤≥]?:\s*Возьмите\s+ещё\s+\d+\s+карты,\s*вы можете сразу же сбросить карты которые вам не нравятся)?$/iu)
  const count = effect ? Number(effect[1] ?? 1) : 0
  return count > 0 ? count : null
}

export function spellPileSearch(description: string): { pile: 'deck' | 'burned'; minimumCost: number } | null {
  if (/^Возьмите выбранную карту из КСК\.?$/iu.test(description)) return { pile: 'burned', minimumCost: 0 }
  const search = description.match(/^Вытащите из КД любую карту стоимостью (\d+) или более\.?$/iu)
  return search ? { pile: 'deck', minimumCost: Number(search[1]) } : null
}

export function entryPileDraw(description: string): { source: 'deck' | 'discard'; from: 'top' | 'bottom'; count: number; cardType?: number } | null {
  if (/^Вход:\s*Возьмите предмет\.\r?\nПосмертно:\s*Отправляет свой предмет на верх КД\.$/iu.test(description)) return { source: 'deck', from: 'top', count: 1, cardType: 1 }
  const text = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  const typed = text.match(/^Возьм(?:и|ите)\s+(существо|предмет|заклинание|здание)\s+из\s+(КД|КС)\.?$/iu)
  if (typed) return { source: typed[2]?.toUpperCase() === 'КД' ? 'deck' : 'discard', from: 'top', count: 1, cardType: ['существо','предмет','заклинание','здание'].indexOf(typed[1]!.toLowerCase()) }
  const bottom = text.match(/^Возьмите\s+(?:самую нижнюю карту|(\d+) нижние карты)\s+из\s+(КД|КС)\.?$/iu)
  return bottom ? { source: bottom[2]?.toUpperCase() === 'КД' ? 'deck' : 'discard', from: 'bottom', count: Number(bottom[1] ?? 1) } : null
}

export function entrySavePiles(description: string): Array<'deck' | 'discard' | 'burned'> | null {
  const entryText = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  return /Вытащите по 1 карте из КД, КС и КСК и сберегите их\.?/iu.test(entryText) ? ['deck', 'discard', 'burned'] : null
}

export function takePileCard<T extends { Type: number }>(pile: T[], source: 'deck' | 'discard' | 'burned', from: 'top' | 'bottom', cardType?: number): T | null {
  const searchFromStart = (source === 'deck') === (from === 'top')
  let index = searchFromStart ? 0 : pile.length-1
  while (index >= 0 && index < pile.length) {
    if (cardType === undefined || pile[index]?.Type === cardType) return pile.splice(index,1)[0] ?? null
    index += searchFromStart ? 1 : -1
  }
  return null
}

export function takeAndShufflePileCard<T extends { Type: number }>(pile: T[], cardType: number, random = Math.random): T | null {
  const index = pile.findIndex(card => card.Type === cardType)
  if (index < 0) return null
  const [card] = pile.splice(index, 1)
  for (let i = pile.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const current = pile[i]!
    pile[i] = pile[j]!
    pile[j] = current
  }
  return card ?? null
}

export function entryHandLimitDelta(description: string): number | null {
  const entryText = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  const change = entryText.match(/(Уменьшает|Увеличивает)\s+лимит\s+карт\s+на\s+(\d+)/iu)
  if (!change) return null
  const amount = Number(change[2] ?? 0)
  return (change[1] ?? '').toLowerCase() === 'уменьшает' ? -amount : amount
}

export function entryResourceGain(description: string): { resource: 'mana' | 'energy'; amount: number } | null {
  const text = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  const gain = text.match(/^Получите\s+(\d+)\s+(маны|энергии)\.?$/iu)
  return gain ? { resource: gain[2]?.toLowerCase() === 'маны' ? 'mana' : 'energy', amount: Number(gain[1]) } : null
}

export function entryNeighborBuffs(description: string): { left?: { health: number }; right?: { attack: number } } | null {
  const entryText = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  const left = entryText.match(/Существо слева получает \+(\d+)\s*❤️/u)
  const right = entryText.match(/(?:а\s*)?справа\s*(?:получает\s*)?\+(\d+)\s*⚔/u)
  return left || right ? { ...(left ? { left: { health: Number(left[1]) } } : {}), ...(right ? { right: { attack: Number(right[1]) } } : {}) } : null
}

export function applyEntryNeighborBuff<T extends { attack: number; health: number; maxHealth: number }>(state: T, buff: { attack?: number; health?: number }): T {
  return { ...state, attack: state.attack + (buff.attack ?? 0), health: state.health + (buff.health ?? 0), maxHealth: state.maxHealth + (buff.health ?? 0) }
}

export function opponentDamageAndHeal(description: string): { damage: number; heal: number } | null {
  const match = description.match(/Нанесите\s+(\d+)\s+урона?\s+противнику\s+и\s+восстанавливает\s+вам\s+(\d+)\s+здоров/iu)
  return match ? { damage: Number(match[1] ?? 0), heal: Number(match[2] ?? 0) } : null
}

export function entryTargetOperation(description: string): EntryTargetOperation | null {
  const entryText = description.match(/Вход:\s*([\s\S]*?)(?=\r?\n\s*(?:Постоянно|Посмертно|Коронный|Ловушка|Способность|Счёт|Хорни)\s*:|$)/iu)?.[1] ?? ''
  const salubraHeal = entryText.match(/Восстанавливает\s+(\d+)\s+здоровья?\s+вашим\s+существам,\s*а\s+вы\s+получаете\s+(\d+)\s+энерги(?:ю|и)\s+за\s+каждое\s+исцелённое/iu)
  if (salubraHeal) return { kind: 'heal-allied-creatures-and-gain-energy', heal: Number(salubraHeal[1]), energy: Number(salubraHeal[2]) }
  const damageTarget = entryText.match(/Наносит\s+(\d+)\s+урона?\s+выбранной\s+цел[иь]/iu)
  if (damageTarget) return { kind: 'damage-target', amount: Number(damageTarget[1]) }
  if (/Забирает предмет у выбранного существа/iu.test(entryText)) return { kind: 'take-target-item' }
  if (/Если у выбранного существа нет ⚪, дайте ему 3 любых ⚪ на выбор/iu.test(entryText)) return { kind: 'give-type-tokens-if-none', count: 3 }
  if (/Гамба:\s*1\s*[-–]\s*4\s+Наносит\s+1\s+урона?\s+выбранному\s+существу\s+за\s+каждое\s+существо\s+на\s+столе/iu.test(entryText)) return { kind: 'gamba-damage-each-creature', maximumRoll: 4 }
  if (/Сберегает\s+союзную\s+карту\s+на\s+поле/iu.test(entryText)) return { kind: 'save-allied-card' }
  if (/Сберегите\s+ваш[а-яё]*\s+существ[а-яё]*\s+на\s+поле/iu.test(entryText)) return { kind: 'save-target' }
  if (/Возвращает выбранное существо обратно в руку/iu.test(entryText)) return { kind: 'return-creature-to-hand' }
  if (/Сберегите выбранную перев(?:ё|е)рнутую карту/iu.test(entryText)) return { kind: 'save-flipped' }
  if (/Выберите вражеское здание[^\r\n]*теперь оно ваше/iu.test(entryText)) return { kind: 'take-enemy-building' }
  if (/Передвигает выбранное здание на 1 сокет/iu.test(entryText)) return { kind: 'move-building-one' }
  if (/Уничтожает здание/iu.test(entryText)) return { kind: 'destroy-building' }
  const sacrificeHeal = entryText.match(/Убивает союзное существо и восстанавливает вам (\d+) здоров/iu)
  if (sacrificeHeal) return { kind: 'sacrifice-ally-heal-player', amount: Number(sacrificeHeal[1]) }
  const selectedHeal = entryText.match(/Восстанавливает\s+(\d+)\s+здоровья?\s+выбранной\s+цели/iu)
  if (selectedHeal) return { kind: 'heal-creature', amount: Number(selectedHeal[1]) }
  const heal = /Полностью восстанавливает здоровье выбранному существу/iu.test(entryText)
  if (heal) {
    const flip = entryText.match(/Переворот\s+(\d+)/iu)
    return flip ? { kind: 'heal-creature', flipTurns: Number(flip[1]) } : { kind: 'heal-creature' }
  }
  const stun = entryText.match(/накладывает\s+на\s+(?:(ваше|союзное|вражеское)\s+)?существо\s+оглушение\s+(\d+)/iu)
  const enemyStun = entryText.match(/накладывает оглушение\s+(\d+)\s+на выбранное вражеское существо/iu)
  if (stun || enemyStun) return { kind: 'stun-target', turns: Number(stun?.[2] ?? enemyStun?.[1]), targetOwner: enemyStun || stun?.[1] === 'вражеское' ? 'enemy' : stun?.[1] ? 'ally' : 'any', ...(/(?:если|есди)\s+вы\s+сожгли\s+карту\s+в\s+этом\s+ходу/iu.test(entryText) ? { condition: 'burned-this-turn' as const } : {}) }
  return null
}

export function entryOperationConditionMet(operation: EntryTargetOperation | null, burnedThisTurn: boolean): boolean {
  return operation?.kind !== 'stun-target' || operation.condition !== 'burned-this-turn' || burnedThisTurn
}

export function entryCanTargetPlayer(description: string, sourceRow: number, owner: number): boolean {
  return entryTargetOperation(description)?.kind === 'damage-target' && sourceRow === (owner === 0 ? 0 : 4)
}

export function hasWhiteTypeTokens(unit: { typeTokens?: number[] }): boolean {
  return (unit.typeTokens ?? []).some(count => count > 0)
}

export function addTypeToken(tokens: number[], tokenClass: number): number[] {
  const next = [...tokens]
  next[tokenClass] = (next[tokenClass] ?? 0) + 1
  return next
}

export function entryScorePlayFromDeck(description: string): { maximumHandCount: number } | null {
  const match = description.match(/Счёт\s*<\s*(\d+)\s*:\s*Разыграйте\s+верхнюю\s+карту\s+из\s+КД/iu)
  return match ? { maximumHandCount: Number(match[1]) } : null
}

export function entryScoreConditionMet(description: string, handCount: number, thresholdAdjustment = 0): boolean {
  const effect = entryScorePlayFromDeck(description)
  return Boolean(effect && handCount <= effect.maximumHandCount + thresholdAdjustment)
}

export type EntryOpponentDamage = { amount: number; minimumSavedCreatures?: number; maximumSavedCreatureCost?: number }

export function entryPlayerHealAmount(description: string): number | null {
  const entryText = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  const match = entryText.match(/Восстанавливает\s+вам\s+(\d+)\s+здоров/iu)
  return match ? Number(match[1]) : null
}

export function entryDiscardsEntireHand(description: string): boolean {
  return /Вход:\s*Сбросьте\s+(?:всю\s+)?свою\s+руку/iu.test(description)
}

export function entryOpponentDamage(description: string): EntryOpponentDamage | null {
  const entryText = description.match(/Вход:\s*([^\r\n]*)/iu)?.[1] ?? ''
  const damage = entryText.match(/Наносит\s+(\d+)\s+урона\s+противнику(?:\s+если\s+у\s+вас\s+есть\s+минимум\s+(\d+)\s+сбереж[её]нных\s+существ(?:а)?\s+стоимостью\s+(\d+)\s+или\s+меньше)?/iu)
  if (!damage) return null
  return {
    amount: Number(damage[1]),
    ...(damage[2] ? { minimumSavedCreatures: Number(damage[2]), maximumSavedCreatureCost: Number(damage[3]) } : {}),
  }
}

export function isRepeatableAbility(description: string, index = 0): boolean {
  return /🔁/u.test(abilityDescription(description, index))
}

export function abilityDrawCount(description: string, index = 0): number | null {
  const firstAbility = abilityDescription(description, index)
  if (!firstAbility) return null
  const draw = firstAbility.match(/Возьмите\s+(\d*)\s*карт(?:у|ы)?/iu)
  return draw ? Math.max(1, Number(draw[1] || 1)) : null
}

export function abilityDescriptions(description: string): string[] {
  const abilityHeaders = [...description.matchAll(/Способность[^\r\n]*/giu)]
  const otherHeaders = [...description.matchAll(/(?:^|[\r\n/.])\s*((?:Постоянно|Посмертно|Коронный|Ловушка|Вход|Счёт|Гамба|Хорни)\s*:)/giu)]
  return abilityHeaders.map((header, index) => {
    const start = header.index ?? 0
    const contentStart = start + header[0].length
    const nextAbility = abilityHeaders[index + 1]?.index ?? description.length
    const nextOther = otherHeaders.map(match => (match.index ?? description.length) + match[0].indexOf(match[1] ?? '')).find(at => at >= contentStart) ?? description.length
    return description.slice(start, Math.min(nextAbility, nextOther)).trim()
  })
}

export function abilityDescription(description: string, index = 0): string {
  return abilityDescriptions(description)[index] ?? ''
}

export function abilityCostResource(description: string, index = 0): 'mana' | 'black-token' {
  return /Способность\s+\d+\s*⚫/u.test(abilityDescription(description, index)) ? 'black-token' : 'mana'
}

export function abilityCostOnField<T extends { owner: number; dying?: boolean; flippedTurns?: number; card: { Name?: string } }>(description: string, index: number, owner: number, units: T[]): number {
  const baseCost = Number(abilityDescription(description, index).match(/Способность\s+(\d+)/u)?.[1] ?? 0)
  const akitas = units.filter(unit => unit.owner === owner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Акита Неру').length
  const rivalSinger = units.some(unit => unit.owner !== owner && !unit.dying && (unit.card.Name === 'Хатсуне Мику' || unit.card.Name === 'Касане Тето'))
  return Math.max(0, baseCost - akitas * (rivalSinger ? 3 : 1))
}

export type TargetedAbilityOperation =
  | { kind: 'adjust-next-score' }
  | { kind: 'damage-target'; amount: number; targetType?: 'creature' | 'building' }
  | { kind: 'damage-targets'; amount: number; count: number; targetType?: 'creature' | 'building' }
  | { kind: 'damage-line'; amount: number }
  | { kind: 'damage-opponent'; amount: number }
  | { kind: 'sacrifice-building-for-attack'; amount: number }
  | { kind: 'heal-targets'; amount: number; count: number; targetType?: 'creature' | 'building' }
  | { kind: 'heal-target'; amount: number; shield?: boolean; targetType?: 'creature' }
  | { kind: 'stun-target'; turns: number }
  | { kind: 'move-self'; stunAdjacent?: number }
  | { kind: 'swap-self' }
  | { kind: 'move-target-front' }
  | { kind: 'destroy-target'; targetType?: 'creature' | 'building' }
  | { kind: 'destroy-self' }
  | { kind: 'gamba-destroy-or-gain-mana'; maximumRoll: number; mana: number }
  | { kind: 'gain-black-token'; amount: number }
  | { kind: 'gain-player-mana'; amount: number }
  | { kind: 'gain-self-shield' }
  | { kind: 'buff-allied-health'; amount: number }
  | { kind: 'take-discard-top' }
  | { kind: 'lock-movement-next-turn' }
  | { kind: 'save-target' }
  | { kind: 'put-target-on-deck' }
  | { kind: 'draw-or-increase-hand-limit'; amount: number }
  | { kind: 'next-attack-splash'; amount: number }

export function addDistinctTarget<T>(targets: T[], target: T): T[] | null {
  return targets.includes(target) ? null : [...targets, target]
}

export function takeTopDiscard<T>(discard: T[], excluded?: T): T | null {
  let index = discard.length - 1
  while (index >= 0 && discard[index] === excluded) index--
  return index >= 0 ? discard.splice(index, 1)[0] ?? null : null
}

export function targetedAbilityOperation(description: string, index = 0): TargetedAbilityOperation | null {
  const firstAbility = abilityDescription(description, index)
  if (!firstAbility) return null
  const deathGamba = firstAbility.match(/Гамба\s*:\s*\n?\s*1\s*[-–]\s*(\d+)\s*[-—:]?\s*умирает[\s\S]*?\n\s*(\d+)\s*[-–]\s*6\s*[-—:]?\s*(?:получите|получает)\s*(\d+)\s*маны?/iu)
  if (deathGamba) return { kind: 'gamba-destroy-or-gain-mana', maximumRoll: Number(deathGamba[1]), mana: Number(deathGamba[3]) }
  const nextAttackSplash = firstAbility.match(/Следующая атака дополнительно нанес[её]т\s+(\d+)\s+урона? атакованному существу и существам справа и слева от него/iu)
  if (nextAttackSplash) return { kind: 'next-attack-splash', amount: Number(nextAttackSplash[1]) }
  const drawOrLimit = firstAbility.match(/Возьмите карту или увеличьте лимит карт на (\d+) до конца следующего хода/iu)
  if (drawOrLimit) return { kind: 'draw-or-increase-hand-limit', amount: Number(drawOrLimit[1]) }
  const alliedHealth = firstAbility.match(/Все ваши существа получают\s+(\d+)[^\r\n]*до начала вашего следующего хода/iu)
  if (alliedHealth) return { kind: 'buff-allied-health', amount: Number(alliedHealth[1]) }
  const gainToken = firstAbility.match(/Способность[^:]*:\s*Получает\s+(\d+)\s*⚫/iu)
  if (gainToken) return { kind: 'gain-black-token', amount: Number(gainToken[1]) }
  if (/Увеличьте или уменьшите требование следующего сч[её]та на 1/iu.test(firstAbility)) return { kind: 'adjust-next-score' }
  const gainMana = firstAbility.match(/Способность[^:]*:\s*Вы\s+получаете\s+(\d+)\s+ман/iu)
  if (gainMana) return { kind: 'gain-player-mana', amount: Number(gainMana[1]) }
  if (/Способность[^:]*:\s*Получает\s+щит/iu.test(firstAbility)) return { kind: 'gain-self-shield' }
  if (/Возьмите\s+верхнюю\s+карту\s+из\s+КС(?:\s|[.!?,]|$)/iu.test(firstAbility)) return { kind: 'take-discard-top' }
  if (/на\s+следующем\s+ходу\s+все\s+существа\s+не\s+могут\s+передвигаться\s+до\s+начала\s+вашего\s+следующего\s+хода/iu.test(firstAbility)) return { kind: 'lock-movement-next-turn' }
  const opponentDamage = firstAbility.match(/Наносит\s+(\d+)\s+урона?\s+противнику/iu)
  if (opponentDamage) return { kind: 'damage-opponent', amount: Number(opponentDamage[1]) }
  const sacrificeBuilding = firstAbility.match(/Уничтожает\s+ваше\s+здание[^\n]*?получить\s*\+(\d+)\s*⚔/iu)
  if (sacrificeBuilding) return { kind: 'sacrifice-building-for-attack', amount: Number(sacrificeBuilding[1]) }
  const lineDamage = firstAbility.match(/Наносит\s+(\d+)\s+урона?\s+существам\s+на\s+линии/iu)
  if (lineDamage) return { kind: 'damage-line', amount: Number(lineDamage[1]) }
  if (/Сберегает\s+выбранную\s+карту\s+на\s+поле/iu.test(firstAbility)) return { kind: 'save-target' }
  if (/Выбранное\s+существо\s+отправляется\s+наверх\s+КД\s+владельца/iu.test(firstAbility)) return { kind: 'put-target-on-deck' }
  const multipleHeal = firstAbility.match(/Восстановите\s+(\d+)\s+здоровья?\s+(трём|трем|двум|двумя|\d+)\s+выбранным\s+разным\s+цел/iu)
  if (multipleHeal) {
    const countText = multipleHeal[2]?.toLowerCase()
    const count = countText === 'трём' || countText === 'трем' ? 3 : countText === 'двум' || countText === 'двумя' ? 2 : Number(countText)
    const targetType = targetKindInDescription(firstAbility)
    return { kind: 'heal-targets', amount: Number(multipleHeal[1]), count, ...(targetType ? { targetType } : {}) }
  }
  const multipleDamage = firstAbility.match(/Нанесите\s+(\d+)\s+урона?\s+(трём|трем|двум|двумя|\d+)\s+выбранным\s+разным\s+цел/iu)
  if (multipleDamage) {
    const countText = multipleDamage[2]?.toLowerCase()
    const count = countText === 'трём' || countText === 'трем' ? 3 : countText === 'двум' || countText === 'двумя' ? 2 : Number(countText)
    const targetType = targetKindInDescription(firstAbility)
    return { kind: 'damage-targets', amount: Number(multipleDamage[1]), count, ...(targetType ? { targetType } : {}) }
  }
  if (/Сбрасывает(?:ся)?\s*$/iu.test(firstAbility) || /Умирает\s*$/iu.test(firstAbility) || /Уничтожается\s*$/iu.test(firstAbility)) return { kind: 'destroy-self' }
  if (/Меня[а-яё]*\s+местами\s+с\s+выбранным\s+существом/iu.test(firstAbility)) return { kind: 'swap-self' }
  if (/Переносит\s+выбранное\s+существо\s+в\s+сокет\s+перед\s+собой/iu.test(firstAbility)) return { kind: 'move-target-front' }
  if (/Переносит(?:ся|ься) на (?:выбранный сокет|любой не занятый сокет)/iu.test(firstAbility)) {
    const stun = firstAbility.match(/оглушение\s+(\d+)/iu)
    return stun ? { kind: 'move-self', stunAdjacent: Number(stun[1]) } : { kind: 'move-self' }
  }
  const damage = firstAbility.match(/(?:Нанесите|Наносит)\s+(\d+)\s+урон/iu)
  if (damage) {
    const targetType = targetKindInDescription(firstAbility)
    return { kind: 'damage-target', amount: Number(damage[1]), ...(targetType ? { targetType } : {}) }
  }
  const heal = firstAbility.match(/(?:Восстановите|Восстанавливает)[^\n]{0,60}?([0-9]+)\s*здоров/iu)
  if (heal) return {
    kind: 'heal-target',
    amount: Number(heal[1]),
    shield: /(?:даёт|дает) щит/iu.test(firstAbility),
    targetType: /(?:существ|сущесвт)/iu.test(firstAbility) ? 'creature' : undefined,
  }
  const stun = firstAbility.match(/Оглушение\s+(\d+)/iu)
  if (stun) return { kind: 'stun-target', turns: Number(stun[1]) }
  if (/(?:Убейте|Убивает|Уничтожьте|Уничтожает)\s+(?:выбранное|выбранную|цель)/iu.test(firstAbility)) return { kind: 'destroy-target', targetType: targetKindInDescription(firstAbility) }
  return null
}

export function abilityCanTargetPlayer(description: string, index: number, onEnemyHomeRow: boolean, cardName: string): boolean {
  const operation = targetedAbilityOperation(description, index)
  return onEnemyHomeRow && cardName !== 'Герсон Бум' && operation?.kind === 'damage-target' && !operation.targetType
}

export function expireTemporaryHandLimit(expirations: number[], turnIndex: number): number {
  const remaining = expirations.filter(expiration => expiration > turnIndex)
  const expired = expirations.length - remaining.length
  expirations.splice(0, expirations.length, ...remaining)
  return expired
}

export function winnerWhenPlayerFalls(loserSeat: 0 | 1): 0 | 1 {
  return loserSeat === 0 ? 1 : 0
}

export type DamageState = { health: number; shield: boolean; dying: boolean; flippedTurns: number }
export type DamageResult = { state: DamageState; absorbed: boolean; lethal: boolean }

export function incomingDamageReduction<T extends { owner: number; dying?: boolean; flippedTurns?: number; card: { Name?: string } }>(units: T[], targetOwner: number, targetType: number): number {
  const reduction = units.filter(unit => unit.owner === targetOwner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Хатсуне Мику').length
  const increase = targetType === 0 ? units.filter(unit => unit.owner !== targetOwner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Касане Тето').length : 0
  return reduction - increase
}

export function ameHealingReward<T extends { owner: number; dying?: boolean; flippedTurns?: number; card: { Name?: string } }>(units: T[], owner: number, beforeHealth: number, maxHealth: number, healedAmount: number): number {
  if (healedAmount <= 0 || beforeHealth >= maxHealth) return 0
  return units.filter(unit => unit.owner === owner && !unit.dying && !unit.flippedTurns && unit.card.Name === 'Аме').length
}

export function applyUnitDamage(state: DamageState, amount: number, reduction = 0): DamageResult {
  amount = Math.max(0, amount - reduction)
  if (amount <= 0 || state.dying || state.flippedTurns > 0) return { state: { ...state }, absorbed: false, lethal: false }
  if (state.shield) return { state: { ...state, shield: false }, absorbed: true, lethal: false }
  const health = state.health - amount
  return { state: { ...state, health }, absorbed: false, lethal: health <= 0 }
}

export type CombatStats = { attack: number; health: number; speed: number; maxHealth?: number }

export function applyTemporaryHealthBuff<T extends { health: number; maxHealth: number; temporaryHealth: number }>(state: T, amount: number): T {
  return { ...state, health: state.health + amount, maxHealth: state.maxHealth + amount, temporaryHealth: state.temporaryHealth + amount }
}

export function expireTemporaryHealthBuff<T extends { health: number; maxHealth: number; temporaryHealth: number }>(state: T): T {
  return { ...state, health: Math.max(0, state.health - state.temporaryHealth), maxHealth: state.maxHealth - state.temporaryHealth, temporaryHealth: 0 }
}

export function applyStatBuff<T extends CombatStats>(state: T, amount: number): T {
  return {
    ...state,
    attack: state.attack + amount,
    health: state.health + amount,
    speed: state.speed - amount,
    ...(state.maxHealth === undefined ? {} : { maxHealth: state.maxHealth + amount }),
  }
}

export function applyCombatStatChanges<T extends CombatStats>(state: T, attackChange: number, speedChange: number): T {
  return { ...state, attack: state.attack + attackChange, speed: state.speed - speedChange - attackChange }
}

export function expireTemporaryAttack<T extends { attack: number; temporaryAttack: number }>(state: T): T {
  return { ...state, attack: state.attack - state.temporaryAttack, temporaryAttack: 0 }
}

export function temporaryHealthExpiresAtTurn(expiry: number, turnIndex: number): boolean { return expiry > 0 && expiry <= turnIndex }


export function entryTokenGain(description: string, handCount: number, thresholdAdjustment = 0): number {
  return [...description.matchAll(/Вход\s*:/giu)].filter(entry => {
    const lineStart = description.lastIndexOf('\n', entry.index) + 1
    const score = description.slice(lineStart, entry.index)
    return !/Счёт/iu.test(score) || scoreConditionMet(score, handCount, thresholdAdjustment)
  }).length
}


export function grantEntryEffectTokens<T extends { card?: { Name?: string }; owner?: number; blackTokens: number }>(units: T[], owner: number, count: number, resolved = true): number {
  const recipients = units.filter(unit => unit.owner === owner && unit.card?.Name === 'Илья_08')
  if (resolved) recipients.forEach(unit => unit.blackTokens += count)
  return recipients.length
}


export function flipTriggerEffect(name: string): { stats: number; draw: number; mana: number } | null {
  return name === '.Хихо' ? { stats: 1, draw: 1, mana: 1 } : null
}

export function resolveFlipTrigger<T extends { attack: number; health: number; maxHealth: number; speed: number }>(name: string, state: T): { state: T; draw: number; mana: number } {
  const effect = flipTriggerEffect(name)
  if (!effect) return { state, draw: 0, mana: 0 }
  return { state: applyStatBuff(state, effect.stats), draw: effect.draw, mana: effect.mana }
}


export function supportedEntryEffect(description: string): boolean {
  return Boolean(entryResourceGain(description) || entryPileDraw(description) || entrySavePiles(description) || entryDrawCount(description) !== null || entryDrawToHandSize(description) !== null || entryNeighborBuffs(description) || entryTargetOperation(description) || entryOpponentDamage(description) || entryPlayerHealAmount(description) !== null || entryDiscardsEntireHand(description) || entryHandLimitDelta(description) !== null)
}


export function entryEffectConditionMet(description: string, handCount: number, thresholdAdjustment = 0): boolean {
  const entry = description.match(/Вход\s*:/iu)
  if (!entry) return false
  const lineStart = description.lastIndexOf('\n', entry.index) + 1
  const prefix = description.slice(lineStart, entry.index)
  const score = prefix.match(/Счёт\s*(?:(?:\d+\s*[<>≤≥])|(?:[<>≤≥]\s*\d+)|(?:\d+))/iu)
  return !score || scoreConditionMet(score[0], handCount, thresholdAdjustment)
}

export function entryBuffForCard(name: string, hasBuilding: boolean): { attack: number } | null {
  return name === 'Безумный манекен' && hasBuilding ? { attack: 2 } : null
}

export function entryRoundStatBuff(description: string): { attack: number; health: number; minimumRound: number } | null {
  const match = description.match(/Вход:\s*Получает\s+\+(\d+)\s*⚔️\s*и\s*\+(\d+)\s*❤️\s+если\s+у\s+вас\s+(\d+)\s+раунд\.?/iu)
  return match ? { attack: Number(match[1]), health: Number(match[2]), minimumRound: Number(match[3]) } : null
}

export function adjustGambaRoll(roll: number, modifier = 0): number { return Math.max(1, Math.min(6, Math.trunc(roll) + Math.trunc(modifier))) }

export function gambaModifierForUnit(unit: { item?: { Name: string }; flippedTurns?: number; dying?: boolean }): number {
  return !unit.flippedTurns && !unit.dying && unit.item?.Name === 'Алмаз' ? 1 : 0
}

export function effectiveUnitSpeed(unit: { speed: number; shield: boolean; card: { Name: string; Speed?: number }; energyCostReduction?: number; flippedTurns?: number; dying?: boolean }): number {
  // Clamp only the paid cost so stacked temporary buffs can be removed without losing permanent bonuses.
  return Math.max(unit.card.Speed === 0 ? 0 : 1, unit.speed - (unit.card.Name === 'Глифид-страж' && !unit.shield && !unit.flippedTurns && !unit.dying ? 2 : 0) - (unit.energyCostReduction ?? 0))
}

export function effectiveUnitAttack(unit: { attack: number; health: number; card: { Name: string }; flippedTurns?: number; dying?: boolean }): number {
  if (unit.flippedTurns || unit.dying) return unit.attack
  if (unit.card.Name === 'PT4OLKA') return Math.max(0, unit.health)
  return unit.attack + (unit.card.Name === 'Думслеер' && unit.health <= 2 ? 4 : 0)
}

export function gambaDamageOperation(description: string): { kind: 'damage-by-roll' } | null {
  return /Гамба[\s:：]*[\s\S]*Нанесите\s+выбранной\s+цели\s+столько\s+урона,\s+сколько\s+выпало/iu.test(description) ? { kind: 'damage-by-roll' } : null
}

export function entryDebuffForCard(name: string): { attack: number; speed: number } | null {
  if (name === 'Железная няня') return { attack: -1, speed: 0 }
  return name === 'Бараш' ? { attack: -2, speed: -2 } : null
}


export function payCardCost<T extends { health: number; mana: number }>(player: T, cost: number, resource: 'health' | 'mana'): boolean {
  if (resource === 'health' ? player.health <= cost : player.mana < cost) return false
  player[resource] -= cost
  return true
}

export function refundCardCost<T extends { health: number; mana: number }>(player: T, cost: number, resource: 'health' | 'mana'): void {
  player[resource] += cost
}


export function canUseHealthPayment(cardType: number, bloodEmpireActive: boolean): boolean {
  return cardType !== 0 && bloodEmpireActive
}

export function weakestCreatureTargets<T extends { id?: string; card: { Type: number }; health: number; dying?: boolean }>(units: T[], excludedId?: string): T[] {
  const creatures=units.filter(unit=>unit.card.Type===0&&!unit.dying&&unit.health>0&&unit.id!==excludedId)
  if(!creatures.length)return []
  const health=Math.min(...creatures.map(unit=>unit.health))
  return creatures.filter(unit=>unit.health===health)
}

export function deathEffectPasses(unit: { owner: number; card: { Type: number } }, sources: Array<{ owner: number; card: { Name: string }; dying?: boolean; flippedTurns?: number }>): number {
  return unit.card.Type === 0 && sources.some(source => source.owner === unit.owner && source.card.Name === 'Маринует мясо' && !source.dying && !source.flippedTurns) ? 2 : 1
}
